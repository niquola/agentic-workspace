import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── auth.ts ──
import {
  mintUnsignedJWT,
  decodeJWTPayload,
  actorFromToken,
  bearerTokenFromRequest,
  actorFromRequest,
  encodeInternalActor,
  decodeInternalActor,
  normalizeDisplayName,
  type Actor,
} from "../auth.ts";

// ── protocol.ts ──
import {
  isTerminalRunState,
  wsURLForRequest,
  namespaceBase,
  topicEventsPath,
  workspaceBase,
  type RunState,
} from "../protocol.ts";

// ── ui/files.tsx ──
import { isTextFile, listDir } from "../ui/files.tsx";

// =============================================================================
// auth.ts
// =============================================================================

describe("auth", () => {
  // ── normalizeDisplayName ──

  describe("normalizeDisplayName", () => {
    test("trims whitespace", () => {
      expect(normalizeDisplayName("  Alice  ", "x")).toBe("Alice");
    });

    test("collapses internal whitespace", () => {
      expect(normalizeDisplayName("Alice   Bob", "x")).toBe("Alice Bob");
    });

    test("clips to 64 characters", () => {
      const long = "A".repeat(100);
      expect(normalizeDisplayName(long, "x")).toBe("A".repeat(64));
    });

    test("returns fallback for empty string", () => {
      expect(normalizeDisplayName("", "fallback")).toBe("fallback");
    });

    test("returns fallback for whitespace-only string", () => {
      expect(normalizeDisplayName("   ", "fb")).toBe("fb");
    });

    test("handles tabs and newlines as whitespace", () => {
      expect(normalizeDisplayName("Alice\t\nBob", "x")).toBe("Alice Bob");
    });
  });

  // ── mintUnsignedJWT ──

  describe("mintUnsignedJWT", () => {
    test("produces three dot-separated parts", () => {
      const jwt = mintUnsignedJWT("user-1", "Alice");
      const parts = jwt.split(".");
      expect(parts).toHaveLength(3);
    });

    test("header has alg=none, typ=JWT", () => {
      const jwt = mintUnsignedJWT("user-1", "Alice");
      const [headerB64] = jwt.split(".");
      const header = JSON.parse(
        Buffer.from(headerB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      expect(header).toEqual({ alg: "none", typ: "JWT" });
    });

    test("payload contains sub, name, iss, iat", () => {
      const before = Math.floor(Date.now() / 1000);
      const jwt = mintUnsignedJWT("user-42", "Bob");
      const after = Math.floor(Date.now() / 1000);
      const payload = decodeJWTPayload(jwt);
      expect(payload.sub).toBe("user-42");
      expect(payload.name).toBe("Bob");
      expect(payload.iss).toBe("workspace-demo");
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
    });

    test("signature part is empty (unsigned)", () => {
      const jwt = mintUnsignedJWT("u", "n");
      expect(jwt.endsWith(".")).toBe(true);
      const parts = jwt.split(".");
      expect(parts[2]).toBe("");
    });
  });

  // ── decodeJWTPayload ──

  describe("decodeJWTPayload", () => {
    test("decodes a valid JWT payload", () => {
      const jwt = mintUnsignedJWT("subj", "Display");
      const payload = decodeJWTPayload(jwt);
      expect(payload.sub).toBe("subj");
      expect(payload.name).toBe("Display");
    });

    test("returns {} for token with no payload part", () => {
      expect(decodeJWTPayload("headeronly")).toEqual({});
    });

    test("handles base64url characters (+ / =)", () => {
      // Create a payload with characters that differ between base64 and base64url
      const jwt = mintUnsignedJWT("user/with+special=chars", "Name");
      const payload = decodeJWTPayload(jwt);
      expect(payload.sub).toBe("user/with+special=chars");
    });

    test("handles unicode in payload", () => {
      const jwt = mintUnsignedJWT("uid", "Ren\u00e9 M\u00fcller");
      const payload = decodeJWTPayload(jwt);
      expect(payload.name).toBe("Ren\u00e9 M\u00fcller");
    });

    test("returns {} for malformed base64 payload", () => {
      expect(decodeJWTPayload("header.!!!invalid-base64!!!.sig")).toEqual({});
    });

    test("returns {} for payload that decodes to non-JSON", () => {
      const notJson = Buffer.from("not json at all").toString("base64url");
      expect(decodeJWTPayload(`header.${notJson}.sig`)).toEqual({});
    });

    test("returns {} for empty token string", () => {
      expect(decodeJWTPayload("")).toEqual({});
    });
  });

  // ── actorFromToken ──

  describe("actorFromToken", () => {
    test("extracts actor with sub and name", () => {
      const jwt = mintUnsignedJWT("user-1", "Alice");
      const actor = actorFromToken(jwt);
      expect(actor).toEqual({ id: "user-1", displayName: "Alice" });
    });

    test("returns null when sub is missing", () => {
      // Forge a token with no sub
      const payload = Buffer.from(JSON.stringify({ name: "NoSub" })).toString("base64url");
      const token = `header.${payload}.`;
      expect(actorFromToken(token)).toBeNull();
    });

    test("returns null when sub is empty string", () => {
      const payload = Buffer.from(JSON.stringify({ sub: "", name: "X" })).toString("base64url");
      const token = `header.${payload}.`;
      expect(actorFromToken(token)).toBeNull();
    });

    test("returns null when sub is whitespace only", () => {
      const payload = Buffer.from(JSON.stringify({ sub: "   ", name: "X" })).toString("base64url");
      const token = `header.${payload}.`;
      expect(actorFromToken(token)).toBeNull();
    });

    test("falls back to preferred_username when name is missing", () => {
      const payload = Buffer.from(
        JSON.stringify({ sub: "u1", preferred_username: "alice_u" }),
      ).toString("base64url");
      const token = `h.${payload}.`;
      const actor = actorFromToken(token);
      expect(actor?.displayName).toBe("alice_u");
    });

    test("falls back to email when name and preferred_username missing", () => {
      const payload = Buffer.from(
        JSON.stringify({ sub: "u1", email: "alice@example.com" }),
      ).toString("base64url");
      const token = `h.${payload}.`;
      const actor = actorFromToken(token);
      expect(actor?.displayName).toBe("alice@example.com");
    });

    test("falls back to sub when no display fields present", () => {
      const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
      const token = `h.${payload}.`;
      const actor = actorFromToken(token);
      expect(actor?.displayName).toBe("u1");
    });

    test("normalizes display name (trims, collapses whitespace, clips)", () => {
      const longName = "A".repeat(100);
      const jwt = mintUnsignedJWT("u1", longName);
      const actor = actorFromToken(jwt);
      expect(actor?.displayName).toBe("A".repeat(64));
    });

    test("returns null for completely malformed token", () => {
      expect(actorFromToken("garbage.!!!.data")).toBeNull();
    });
  });

  // ── bearerTokenFromRequest ──

  describe("bearerTokenFromRequest", () => {
    test("extracts bearer token from Authorization header", () => {
      const req = new Request("http://localhost/", {
        headers: { Authorization: "Bearer my-token-123" },
      });
      expect(bearerTokenFromRequest(req)).toBe("my-token-123");
    });

    test("is case-insensitive for Bearer prefix", () => {
      const req = new Request("http://localhost/", {
        headers: { Authorization: "bearer tok" },
      });
      expect(bearerTokenFromRequest(req)).toBe("tok");
    });

    test("returns empty string when no Authorization header", () => {
      const req = new Request("http://localhost/");
      expect(bearerTokenFromRequest(req)).toBe("");
    });

    test("returns empty string for non-Bearer auth", () => {
      const req = new Request("http://localhost/", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(bearerTokenFromRequest(req)).toBe("");
    });

    test("trims whitespace from token", () => {
      const req = new Request("http://localhost/", {
        headers: { Authorization: "Bearer   tok-with-spaces   " },
      });
      expect(bearerTokenFromRequest(req)).toBe("tok-with-spaces");
    });
  });

  // ── actorFromRequest ──

  describe("actorFromRequest", () => {
    test("extracts actor from request with valid JWT bearer", () => {
      const jwt = mintUnsignedJWT("user-1", "Alice");
      const req = new Request("http://localhost/", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const actor = actorFromRequest(req);
      expect(actor).toEqual({ id: "user-1", displayName: "Alice" });
    });

    test("returns null when no Authorization header", () => {
      const req = new Request("http://localhost/");
      expect(actorFromRequest(req)).toBeNull();
    });

    test("returns null for empty bearer token", () => {
      const req = new Request("http://localhost/", {
        headers: { Authorization: "Basic foo" },
      });
      expect(actorFromRequest(req)).toBeNull();
    });
  });

  // ── encodeInternalActor / decodeInternalActor ──

  describe("encodeInternalActor / decodeInternalActor", () => {
    test("roundtrips an actor", () => {
      const actor: Actor = { id: "user-1", displayName: "Alice" };
      const encoded = encodeInternalActor(actor);
      const decoded = decodeInternalActor(encoded);
      expect(decoded).toEqual(actor);
    });

    test("roundtrips actor with unicode", () => {
      const actor: Actor = { id: "u2", displayName: "Ren\u00e9" };
      const encoded = encodeInternalActor(actor);
      expect(decodeInternalActor(encoded)).toEqual(actor);
    });

    test("decodeInternalActor returns null for null input", () => {
      expect(decodeInternalActor(null)).toBeNull();
    });

    test("decodeInternalActor returns null for undefined input", () => {
      expect(decodeInternalActor(undefined)).toBeNull();
    });

    test("decodeInternalActor returns null for empty string", () => {
      expect(decodeInternalActor("")).toBeNull();
    });

    test("decodeInternalActor returns null for invalid base64", () => {
      expect(decodeInternalActor("not-valid-json!!!")).toBeNull();
    });

    test("decodeInternalActor returns null when id is missing", () => {
      const encoded = Buffer.from(JSON.stringify({ displayName: "NoId" })).toString("base64url");
      expect(decodeInternalActor(encoded)).toBeNull();
    });

    test("decodeInternalActor returns null when id is empty", () => {
      const encoded = Buffer.from(JSON.stringify({ id: "", displayName: "X" })).toString("base64url");
      expect(decodeInternalActor(encoded)).toBeNull();
    });

    test("decodeInternalActor normalizes displayName", () => {
      const encoded = Buffer.from(
        JSON.stringify({ id: "u1", displayName: "  Alice   Bob  " }),
      ).toString("base64url");
      const decoded = decodeInternalActor(encoded);
      expect(decoded?.displayName).toBe("Alice Bob");
    });

    test("decodeInternalActor uses id as displayName fallback", () => {
      const encoded = Buffer.from(JSON.stringify({ id: "u1" })).toString("base64url");
      const decoded = decodeInternalActor(encoded);
      expect(decoded?.displayName).toBe("u1");
    });
  });
});

// =============================================================================
// protocol.ts
// =============================================================================

describe("protocol", () => {
  // ── isTerminalRunState ──

  describe("isTerminalRunState", () => {
    test("completed is terminal", () => {
      expect(isTerminalRunState("completed")).toBe(true);
    });

    test("cancelled is terminal", () => {
      expect(isTerminalRunState("cancelled")).toBe(true);
    });

    test("failed is terminal", () => {
      expect(isTerminalRunState("failed")).toBe(true);
    });

    test("running is not terminal", () => {
      expect(isTerminalRunState("running")).toBe(false);
    });

    test("queued is not terminal", () => {
      expect(isTerminalRunState("queued")).toBe(false);
    });
  });

  // ── wsURLForRequest ──

  describe("wsURLForRequest", () => {
    test("converts http to ws", () => {
      const req = new Request("http://localhost:3000/some/path?q=1");
      const result = wsURLForRequest(req, "/events");
      expect(result).toBe("ws://localhost:3000/events");
    });

    test("converts https to wss", () => {
      const req = new Request("https://example.com/api/v1");
      const result = wsURLForRequest(req, "/ws/stream");
      expect(result).toBe("wss://example.com/ws/stream");
    });

    test("strips query parameters", () => {
      const req = new Request("http://host:8080/x?foo=bar&baz=1");
      const result = wsURLForRequest(req, "/clean");
      expect(result).toBe("ws://host:8080/clean");
    });

    test("preserves host and port", () => {
      const req = new Request("http://my-host:9999/anything");
      const result = wsURLForRequest(req, "/p");
      expect(result).toBe("ws://my-host:9999/p");
    });
  });

  // ── namespaceBase ──

  describe("namespaceBase", () => {
    test("returns correct path for simple namespace", () => {
      expect(namespaceBase("default")).toBe("/apis/v1/namespaces/default");
    });

    test("encodes special characters", () => {
      expect(namespaceBase("my ns/test")).toBe("/apis/v1/namespaces/my%20ns%2Ftest");
    });
  });

  // ── workspaceBase ──

  describe("workspaceBase", () => {
    test("returns correct path", () => {
      expect(workspaceBase("ns1", "ws1")).toBe(
        "/apis/v1/namespaces/ns1/workspaces/ws1",
      );
    });

    test("encodes both namespace and workspace", () => {
      expect(workspaceBase("n s", "w/s")).toBe(
        "/apis/v1/namespaces/n%20s/workspaces/w%2Fs",
      );
    });
  });

  // ── topicEventsPath ──

  describe("topicEventsPath", () => {
    test("builds correct event path", () => {
      expect(topicEventsPath("ns", "ws", "topic1")).toBe(
        "/apis/v1/namespaces/ns/workspaces/ws/topics/topic1/events",
      );
    });

    test("encodes topic name", () => {
      expect(topicEventsPath("ns", "ws", "my topic")).toBe(
        "/apis/v1/namespaces/ns/workspaces/ws/topics/my%20topic/events",
      );
    });

    test("encodes all path segments", () => {
      expect(topicEventsPath("n/s", "w s", "t&t")).toBe(
        "/apis/v1/namespaces/n%2Fs/workspaces/w%20s/topics/t%26t/events",
      );
    });
  });
});

// =============================================================================
// ui/files.tsx
// =============================================================================

describe("ui/files", () => {
  // ── isTextFile ──

  describe("isTextFile", () => {
    test("recognizes .ts files", () => {
      expect(isTextFile("app.ts")).toBe(true);
    });

    test("recognizes .tsx files", () => {
      expect(isTextFile("component.tsx")).toBe(true);
    });

    test("recognizes .json files", () => {
      expect(isTextFile("package.json")).toBe(true);
    });

    test("recognizes .md files", () => {
      expect(isTextFile("README.md")).toBe(true);
    });

    test("recognizes .py files", () => {
      expect(isTextFile("script.py")).toBe(true);
    });

    test("recognizes .sh files", () => {
      expect(isTextFile("build.sh")).toBe(true);
    });

    test("recognizes .env files", () => {
      expect(isTextFile("config.env")).toBe(true);
    });

    test("recognizes .gitignore", () => {
      expect(isTextFile("my.gitignore")).toBe(true);
    });

    test("recognizes .svg files", () => {
      expect(isTextFile("logo.svg")).toBe(true);
    });

    test("recognizes .lock files", () => {
      expect(isTextFile("bun.lock")).toBe(true);
    });

    test("rejects .png files", () => {
      expect(isTextFile("image.png")).toBe(false);
    });

    test("rejects .jpg files", () => {
      expect(isTextFile("photo.jpg")).toBe(false);
    });

    test("rejects .zip files", () => {
      expect(isTextFile("archive.zip")).toBe(false);
    });

    test("rejects .exe files", () => {
      expect(isTextFile("program.exe")).toBe(false);
    });

    // extensionless files by name
    test("recognizes Makefile (no extension)", () => {
      expect(isTextFile("Makefile")).toBe(true);
    });

    test("recognizes Dockerfile (no extension)", () => {
      expect(isTextFile("Dockerfile")).toBe(true);
    });

    test("recognizes README (no extension, case-insensitive)", () => {
      expect(isTextFile("readme")).toBe(true);
    });

    test("recognizes LICENSE (no extension)", () => {
      expect(isTextFile("license")).toBe(true);
    });

    test("recognizes CHANGELOG (no extension)", () => {
      expect(isTextFile("changelog")).toBe(true);
    });

    test("rejects unknown extensionless files", () => {
      expect(isTextFile("randomname")).toBe(false);
    });

    test("case-insensitive check on known names (uppercase)", () => {
      // "Makefile" -> lowercase = "makefile" which is in the list
      expect(isTextFile("MAKEFILE")).toBe(true);
    });
  });

  // ── listDir ──

  describe("listDir", () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "unit-test-"));
      // Create directory structure
      await mkdir(join(tmpDir, "subdir"));
      await mkdir(join(tmpDir, "alpha-dir"));
      await writeFile(join(tmpDir, "hello.ts"), "console.log('hello');");
      await writeFile(join(tmpDir, "readme.md"), "# Readme");
      await writeFile(join(tmpDir, ".hidden"), "secret");
      await mkdir(join(tmpDir, ".git"));
      await mkdir(join(tmpDir, "node_modules"));
      await writeFile(join(tmpDir, "node_modules", "pkg.json"), "{}");
    });

    afterAll(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    test("lists files and directories", async () => {
      const entries = await listDir(tmpDir, "");
      const names = entries.map((e) => e.name);
      expect(names).toContain("hello.ts");
      expect(names).toContain("readme.md");
      expect(names).toContain("subdir");
      expect(names).toContain("alpha-dir");
    });

    test("excludes hidden files (starting with dot)", async () => {
      const entries = await listDir(tmpDir, "");
      const names = entries.map((e) => e.name);
      expect(names).not.toContain(".hidden");
      expect(names).not.toContain(".git");
    });

    test("excludes node_modules", async () => {
      const entries = await listDir(tmpDir, "");
      const names = entries.map((e) => e.name);
      expect(names).not.toContain("node_modules");
    });

    test("sorts directories before files", async () => {
      const entries = await listDir(tmpDir, "");
      const firstFile = entries.findIndex((e) => !e.isDir);
      const lastDir = entries.findLastIndex((e) => e.isDir);
      if (firstFile !== -1 && lastDir !== -1) {
        expect(lastDir).toBeLessThan(firstFile);
      }
    });

    test("sorts alphabetically within dirs and files", async () => {
      const entries = await listDir(tmpDir, "");
      const dirs = entries.filter((e) => e.isDir).map((e) => e.name);
      const files = entries.filter((e) => !e.isDir).map((e) => e.name);
      expect(dirs).toEqual([...dirs].sort());
      expect(files).toEqual([...files].sort());
    });

    test("includes correct isDir flag", async () => {
      const entries = await listDir(tmpDir, "");
      const subdirEntry = entries.find((e) => e.name === "subdir");
      const fileEntry = entries.find((e) => e.name === "hello.ts");
      expect(subdirEntry?.isDir).toBe(true);
      expect(fileEntry?.isDir).toBe(false);
    });

    test("includes file sizes for files", async () => {
      const entries = await listDir(tmpDir, "");
      const fileEntry = entries.find((e) => e.name === "hello.ts");
      expect(fileEntry?.size).toBeGreaterThan(0);
    });

    test("directories have size 0", async () => {
      const entries = await listDir(tmpDir, "");
      const dirEntry = entries.find((e) => e.name === "subdir");
      expect(dirEntry?.size).toBe(0);
    });

    test("path is relative to workdir", async () => {
      const entries = await listDir(tmpDir, "");
      const fileEntry = entries.find((e) => e.name === "hello.ts");
      expect(fileEntry?.path).toBe("hello.ts");
    });

    test("lists subdirectory with subpath", async () => {
      await writeFile(join(tmpDir, "subdir", "inner.txt"), "inner");
      const entries = await listDir(tmpDir, "subdir");
      const names = entries.map((e) => e.name);
      expect(names).toContain("inner.txt");
      const entry = entries.find((e) => e.name === "inner.txt");
      expect(entry?.path).toBe("subdir/inner.txt");
    });

    test("returns empty array for empty directory", async () => {
      await mkdir(join(tmpDir, "empty-dir"));
      const entries = await listDir(tmpDir, "empty-dir");
      expect(entries).toEqual([]);
    });
  });
});

// =============================================================================
// Persistence format (saveWorkspaces / restoreWorkspaces serialization)
// =============================================================================

describe("persistence format", () => {
  // We test the JSON serialization format that saveWorkspaces produces
  // and restoreWorkspaces expects, without calling those functions directly
  // (they have side effects and depend on global state).

  interface PersistedWorkspace {
    name: string;
    namespace: string;
    id: string;
    mode: "docker" | "local";
    workdir?: string;
    createdAt: string;
    owner?: { id: string; displayName: string };
  }

  test("serialization format is a JSON array of workspace records", () => {
    const records: PersistedWorkspace[] = [
      {
        name: "ws-1",
        namespace: "default",
        id: "abc-123",
        mode: "docker",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("ws-1");
    expect(parsed[0].namespace).toBe("default");
    expect(parsed[0].mode).toBe("docker");
  });

  test("owner field is optional", () => {
    const records: PersistedWorkspace[] = [
      {
        name: "ws-no-owner",
        namespace: "default",
        id: "id-1",
        mode: "local",
        createdAt: "2024-06-01T00:00:00Z",
      },
    ];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed[0].owner).toBeUndefined();
  });

  test("owner is preserved when present", () => {
    const records: PersistedWorkspace[] = [
      {
        name: "ws-owned",
        namespace: "team",
        id: "id-2",
        mode: "docker",
        createdAt: "2024-06-01T00:00:00Z",
        owner: { id: "user-1", displayName: "Alice" },
      },
    ];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed[0].owner).toEqual({ id: "user-1", displayName: "Alice" });
  });

  test("workdir field is present for local mode", () => {
    const records: PersistedWorkspace[] = [
      {
        name: "ws-local",
        namespace: "default",
        id: "id-3",
        mode: "local",
        workdir: "/home/user/project",
        createdAt: "2024-06-01T00:00:00Z",
      },
    ];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed[0].workdir).toBe("/home/user/project");
    expect(parsed[0].mode).toBe("local");
  });

  test("empty array roundtrips", () => {
    const records: PersistedWorkspace[] = [];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed).toEqual([]);
  });

  test("multiple workspaces roundtrip", () => {
    const records: PersistedWorkspace[] = [
      { name: "a", namespace: "ns1", id: "1", mode: "docker", createdAt: "2024-01-01T00:00:00Z" },
      { name: "b", namespace: "ns2", id: "2", mode: "local", workdir: "/tmp/b", createdAt: "2024-01-02T00:00:00Z" },
      { name: "c", namespace: "ns1", id: "3", mode: "docker", createdAt: "2024-01-03T00:00:00Z", owner: { id: "o1", displayName: "Owner" } },
    ];
    const json = JSON.stringify(records, null, 2);
    const parsed = JSON.parse(json) as PersistedWorkspace[];
    expect(parsed).toHaveLength(3);
    expect(parsed.map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(parsed[1].workdir).toBe("/tmp/b");
    expect(parsed[2].owner?.id).toBe("o1");
  });
});

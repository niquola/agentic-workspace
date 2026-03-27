import { describe, test, expect, beforeAll } from "bun:test";

const BASE = process.env.API_BASE || "http://localhost:31337";

/** Fetch a workspace name from the health endpoint so UI tests hit a real workspace. */
let existingWorkspace: string | null = null;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/health`);
    const data = (await res.json()) as {
      containers?: Array<{ workspace: string }>;
    };
    existingWorkspace = data.containers?.[0]?.workspace ?? null;
  } catch {
    // server not reachable — tests will fail with clear messages
  }
});

// =============================================================================
// Health endpoint
// =============================================================================

describe("GET /health", () => {
  test("returns status ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

// =============================================================================
// Render markdown API
// =============================================================================

describe("POST /api/render-md", () => {
  test("renders markdown with code blocks using shiki", async () => {
    const md = "# Hello\n\n```ts\nconst x = 1;\n```\n";
    const res = await fetch(`${BASE}/api/render-md`, {
      method: "POST",
      body: md,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    // Shiki produces <pre> with class="shiki" or a data-theme attribute
    expect(html).toMatch(/shiki|data-theme/);
    // The code content should be present
    expect(html).toContain("const");
  });

  test("renders plain markdown without code blocks", async () => {
    const md = "# Title\n\nSome paragraph text.\n";
    const res = await fetch(`${BASE}/api/render-md`, {
      method: "POST",
      body: md,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Title");
    expect(html).toContain("Some paragraph text.");
  });
});

// =============================================================================
// Static assets
// =============================================================================

describe("Static assets", () => {
  test("GET /styles/main.css returns CSS", async () => {
    const res = await fetch(`${BASE}/styles/main.css`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("css");
  });

  test("GET /js/datastar.js returns JS", async () => {
    const res = await fetch(`${BASE}/js/datastar.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// UI pages
// =============================================================================

describe("UI pages", () => {
  test("GET /ui returns HTML (workspaces list or login redirect)", async () => {
    const res = await fetch(`${BASE}/ui`, { redirect: "manual" });
    if (res.status === 302) {
      // OAuth enabled — redirects to login
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("login");
    } else {
      // No OAuth — renders workspaces page directly
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Workspaces");
    }
  });

  test("GET /ui/:workspace returns workspace page or login redirect", async () => {
    if (!existingWorkspace) {
      console.warn("Skipping: no workspace available from /health");
      return;
    }
    const res = await fetch(
      `${BASE}/ui/${encodeURIComponent(existingWorkspace)}`,
      { redirect: "manual" },
    );
    // Either 200 (no OAuth) or 302 (OAuth redirect to login)
    expect([200, 302]).toContain(res.status);
    if (res.status === 200) {
      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("text/html");
      const html = await res.text();
      expect(html).toContain(existingWorkspace);
    }
  });
});

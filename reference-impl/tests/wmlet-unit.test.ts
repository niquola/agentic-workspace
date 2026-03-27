import { describe, test, expect } from "bun:test";

import {
  relativeWorkspacePath,
  workspacePath,
  randomId,
  cleanEnv,
  describeError,
  toolUpdateData,
  runStateFromStopReason,
  replayable,
  withTimeout,
  jsonError,
} from "../wmlet.ts";

// =============================================================================
// relativeWorkspacePath
// =============================================================================

describe("relativeWorkspacePath", () => {
  test("returns empty string for null", () => {
    expect(relativeWorkspacePath(null)).toBe("");
  });

  test("returns empty string for empty string", () => {
    expect(relativeWorkspacePath("")).toBe("");
  });

  test("returns empty string for whitespace-only", () => {
    expect(relativeWorkspacePath("   ")).toBe("");
  });

  test("normalizes a simple filename", () => {
    expect(relativeWorkspacePath("file.txt")).toBe("file.txt");
  });

  test("normalizes a nested path", () => {
    expect(relativeWorkspacePath("src/main.ts")).toBe("src/main.ts");
  });

  test("strips leading slashes", () => {
    expect(relativeWorkspacePath("/foo/bar")).toBe("foo/bar");
  });

  test("strips multiple leading slashes", () => {
    expect(relativeWorkspacePath("///foo")).toBe("foo");
  });

  test("normalizes redundant slashes", () => {
    expect(relativeWorkspacePath("foo//bar///baz")).toBe("foo/bar/baz");
  });

  test("normalizes dot segments", () => {
    expect(relativeWorkspacePath("foo/./bar")).toBe("foo/bar");
  });

  test("returns empty string for single dot", () => {
    expect(relativeWorkspacePath(".")).toBe("");
  });

  test("returns empty string for slash only", () => {
    expect(relativeWorkspacePath("/")).toBe("");
  });

  test("rejects .. traversal at start", () => {
    expect(() => relativeWorkspacePath("../etc/passwd")).toThrow();
  });

  test("rejects .. traversal in the middle", () => {
    expect(() => relativeWorkspacePath("foo/../../etc")).toThrow();
  });

  test("rejects bare .. ", () => {
    expect(() => relativeWorkspacePath("..")).toThrow();
  });

  test("rejects backslashes", () => {
    expect(() => relativeWorkspacePath("foo\\bar")).toThrow();
  });

  test("rejects backslash traversal", () => {
    expect(() => relativeWorkspacePath("..\\etc")).toThrow();
  });
});

// =============================================================================
// workspacePath
// =============================================================================

describe("workspacePath", () => {
  test("resolves a simple relative path under WORKSPACE_DIR", () => {
    const result = workspacePath("src/main.ts");
    // WORKSPACE_DIR defaults to /workspace
    expect(result).toBe("/workspace/src/main.ts");
  });

  test("resolves empty string to WORKSPACE_DIR root", () => {
    const result = workspacePath("");
    expect(result).toBe("/workspace");
  });

  test("rejects path that escapes WORKSPACE_DIR", () => {
    expect(() => workspacePath("../../etc/passwd")).toThrow();
  });
});

// =============================================================================
// randomId
// =============================================================================

describe("randomId", () => {
  test("starts with the given prefix", () => {
    const id = randomId("run");
    expect(id.startsWith("run_")).toBe(true);
  });

  test("different prefix produces different prefix in output", () => {
    const id = randomId("topic");
    expect(id.startsWith("topic_")).toBe(true);
  });

  test("generates unique IDs across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId("x")));
    expect(ids.size).toBe(50);
  });

  test("contains only valid characters (alphanumeric, underscore)", () => {
    const id = randomId("r");
    expect(id).toMatch(/^r_[a-z0-9]+_[a-z0-9]+$/);
  });
});

// =============================================================================
// cleanEnv
// =============================================================================

describe("cleanEnv", () => {
  test("returns an object (not undefined)", () => {
    const env = cleanEnv();
    expect(typeof env).toBe("object");
  });

  test("does not contain CLAUDECODE key", () => {
    process.env.CLAUDECODE = "test-value";
    const env = cleanEnv();
    expect(env.CLAUDECODE).toBeUndefined();
    delete process.env.CLAUDECODE;
  });

  test("does not contain CLAUDE_CODE_SESSION key", () => {
    process.env.CLAUDE_CODE_SESSION = "session-123";
    const env = cleanEnv();
    expect(env.CLAUDE_CODE_SESSION).toBeUndefined();
    delete process.env.CLAUDE_CODE_SESSION;
  });

  test("preserves other env vars", () => {
    process.env.__TEST_WMLET_UNIT__ = "keep-me";
    const env = cleanEnv();
    expect(env.__TEST_WMLET_UNIT__).toBe("keep-me");
    delete process.env.__TEST_WMLET_UNIT__;
  });

  test("does not mutate process.env", () => {
    process.env.CLAUDECODE = "should-stay";
    cleanEnv();
    expect(process.env.CLAUDECODE).toBe("should-stay");
    delete process.env.CLAUDECODE;
  });
});

// =============================================================================
// describeError
// =============================================================================

describe("describeError", () => {
  test("extracts message from Error instance", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  test("returns string errors as-is", () => {
    expect(describeError("something broke")).toBe("something broke");
  });

  test("handles object with message field", () => {
    expect(describeError({ message: "oops" })).toBe("oops");
  });

  test("handles object with message and code", () => {
    const result = describeError({ message: "fail", code: "ENOENT" });
    expect(result).toContain("fail");
    expect(result).toContain("code=ENOENT");
  });

  test("handles object with numeric code", () => {
    const result = describeError({ message: "err", code: 42 });
    expect(result).toContain("code=42");
  });

  test("handles object with data field", () => {
    const result = describeError({ message: "x", data: "extra" });
    expect(result).toContain("data=extra");
  });

  test("handles object with data as object", () => {
    const result = describeError({ message: "x", data: { foo: 1 } });
    expect(result).toContain("data=");
    expect(result).toContain("foo");
  });

  test("falls back to JSON.stringify for object with no known fields", () => {
    const result = describeError({ unknown: "field" });
    expect(result).toBe('{"unknown":"field"}');
  });

  test("handles null", () => {
    expect(describeError(null)).toBe("null");
  });

  test("handles undefined", () => {
    expect(describeError(undefined)).toBe("undefined");
  });

  test("handles number", () => {
    expect(describeError(42)).toBe("42");
  });

  test("handles boolean", () => {
    expect(describeError(true)).toBe("true");
  });
});

// =============================================================================
// toolUpdateData
// =============================================================================

describe("toolUpdateData", () => {
  test("returns undefined for undefined", () => {
    expect(toolUpdateData(undefined)).toBeUndefined();
  });

  test("returns undefined for null", () => {
    expect(toolUpdateData(null)).toBeUndefined();
  });

  test("returns string values as-is", () => {
    expect(toolUpdateData("hello")).toBe("hello");
  });

  test("returns empty string as-is", () => {
    expect(toolUpdateData("")).toBe("");
  });

  test("JSON-stringifies objects", () => {
    expect(toolUpdateData({ a: 1 })).toBe('{"a":1}');
  });

  test("JSON-stringifies arrays", () => {
    expect(toolUpdateData([1, 2])).toBe("[1,2]");
  });

  test("JSON-stringifies numbers", () => {
    expect(toolUpdateData(42)).toBe("42");
  });

  test("JSON-stringifies booleans", () => {
    expect(toolUpdateData(true)).toBe("true");
  });

  test("falls back to String() for non-serializable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = toolUpdateData(circular);
    expect(typeof result).toBe("string");
  });
});

// =============================================================================
// runStateFromStopReason
// =============================================================================

describe("runStateFromStopReason", () => {
  test("end_turn maps to completed", () => {
    expect(runStateFromStopReason("end_turn")).toBe("completed");
  });

  test("cancelled maps to cancelled", () => {
    expect(runStateFromStopReason("cancelled")).toBe("cancelled");
  });

  test("unknown stop reason maps to failed", () => {
    expect(runStateFromStopReason("max_tokens" as any)).toBe("failed");
  });

  test("arbitrary string maps to failed", () => {
    expect(runStateFromStopReason("something_else" as any)).toBe("failed");
  });
});

// =============================================================================
// replayable
// =============================================================================

describe("replayable", () => {
  test("run_updated is replayable", () => {
    expect(replayable({ type: "run_updated" })).toBe(true);
  });

  test("message is replayable", () => {
    expect(replayable({ type: "message" })).toBe(true);
  });

  test("tool_call is replayable", () => {
    expect(replayable({ type: "tool_call" })).toBe(true);
  });

  test("tool_update is replayable", () => {
    expect(replayable({ type: "tool_update" })).toBe(true);
  });

  test("text_chunk is not replayable", () => {
    expect(replayable({ type: "text_chunk" })).toBe(false);
  });

  test("error is not replayable", () => {
    expect(replayable({ type: "error" })).toBe(false);
  });

  test("topic_state is not replayable", () => {
    expect(replayable({ type: "topic_state" })).toBe(false);
  });
});

// =============================================================================
// withTimeout
// =============================================================================

describe("withTimeout", () => {
  test("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000, "test");
    expect(result).toBe("ok");
  });

  test("rejects with timeout error when promise is too slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, "slow-op")).rejects.toThrow(
      "slow-op timed out after 0.05s",
    );
  });

  test("propagates original rejection", async () => {
    const failing = Promise.reject(new Error("original"));
    await expect(withTimeout(failing, 1000, "test")).rejects.toThrow("original");
  });
});

// =============================================================================
// jsonError
// =============================================================================

describe("jsonError", () => {
  test("returns a Response with correct status", () => {
    const resp = jsonError("not found", 404);
    expect(resp).toBeInstanceOf(Response);
    expect(resp.status).toBe(404);
  });

  test("defaults to status 400", () => {
    const resp = jsonError("bad request");
    expect(resp.status).toBe(400);
  });

  test("body contains JSON error message", async () => {
    const resp = jsonError("oops", 422);
    const body = await resp.json();
    expect(body).toEqual({ error: "oops" });
  });
});

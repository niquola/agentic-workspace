/**
 * Integration tests for wmlet — exercises all HTTP and WebSocket endpoints
 * through the wsmanager proxy layer.
 *
 * Usage: bun test wmlet.test.ts
 * Requires: wsmanager running on :31337 and the workspace image built.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mintUnsignedJWT, encodeInternalActor } from "./auth.ts";

const MANAGER = process.env.WS_MANAGER || "http://localhost:31337";
const WS_NAME = "wmlet-test";
const TOKEN = mintUnsignedJWT("wmlet-tester", "Wmlet Tester");
const TOKEN2 = mintUnsignedJWT("wmlet-tester-2", "Wmlet Tester 2");

function auth(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

function auth2(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN2}`, ...extra };
}

let namespace = "default";

function api(path: string) {
  return `${MANAGER}/apis/v1/namespaces/${namespace}/workspaces/${WS_NAME}${path}`;
}

async function ensureWorkspace() {
  // Delete if exists
  await fetch(api(""), { method: "DELETE", headers: auth() }).catch(() => {});
  await Bun.sleep(1000);

  const res = await fetch(
    `${MANAGER}/apis/v1/namespaces/${namespace}/workspaces`,
    {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: WS_NAME, topics: [{ name: "main" }] }),
    },
  );
  if (!res.ok) throw new Error(`workspace create: ${await res.text()}`);
  return res.json();
}

async function deleteWorkspace() {
  await fetch(api(""), { method: "DELETE", headers: auth() }).catch(() => {});
}

// ── Setup / Teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  const health = await fetch(`${MANAGER}/health`).then((r) => r.json() as any);
  namespace = health.namespace || "default";
  await ensureWorkspace();
}, 60_000);

afterAll(async () => {
  await deleteWorkspace();
}, 30_000);

// ── Health ────────────────────────────────────────────────────────────

describe("health", () => {
  test("manager health returns ok", async () => {
    const res = await fetch(`${MANAGER}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body.workspaces).toBeGreaterThanOrEqual(1);
  });
});

// ── Workspaces ────────────────────────────────────────────────────────

describe("workspaces", () => {
  test("list workspaces includes test workspace", async () => {
    const res = await fetch(
      `${MANAGER}/apis/v1/namespaces/${namespace}/workspaces`,
      { headers: auth() },
    );
    expect(res.ok).toBe(true);
    const list = (await res.json()) as any[];
    const ws = list.find((w) => w.name === WS_NAME);
    expect(ws).toBeDefined();
    expect(ws.status).toBe("running");
  });

  test("get workspace detail", async () => {
    const res = await fetch(api(""), { headers: auth() });
    expect(res.ok).toBe(true);
    const ws = (await res.json()) as any;
    expect(ws.name).toBe(WS_NAME);
    expect(ws.status).toBe("running");
    expect(Array.isArray(ws.topics)).toBe(true);
  });

  test("requires auth", async () => {
    const res = await fetch(api(""));
    expect(res.status).toBe(401);
  });
});

// ── Topics CRUD ───────────────────────────────────────────────────────

describe("topics", () => {
  test("list topics includes main", async () => {
    const res = await fetch(api("/topics"), { headers: auth() });
    expect(res.ok).toBe(true);
    const topics = (await res.json()) as any[];
    expect(topics.some((t) => t.name === "main")).toBe(true);
  });

  test("create topic", async () => {
    const res = await fetch(api("/topics"), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "test-topic" }),
    });
    expect(res.status).toBe(201);
    const topic = (await res.json()) as any;
    expect(topic.name).toBe("test-topic");
  });

  test("create duplicate topic returns 409", async () => {
    const res = await fetch(api("/topics"), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "test-topic" }),
    });
    expect(res.status).toBe(409);
  });

  test("create topic without name returns 400", async () => {
    const res = await fetch(api("/topics"), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("get topic state", async () => {
    const res = await fetch(api("/topics/main"), { headers: auth() });
    expect(res.ok).toBe(true);
    const state = (await res.json()) as any;
    expect(state.name).toBe("main");
    expect(state.activeRun).toBeNull();
    expect(Array.isArray(state.queue)).toBe(true);
    expect(state.events).toContain("/events");
  });

  test("get nonexistent topic returns 404", async () => {
    const res = await fetch(api("/topics/nonexistent"), { headers: auth() });
    expect(res.status).toBe(404);
  });

  test("delete topic", async () => {
    // Create then delete
    await fetch(api("/topics"), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "to-delete" }),
    });
    const res = await fetch(api("/topics/to-delete"), {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.ok).toBe(true);

    // Verify gone
    const check = await fetch(api("/topics/to-delete"), { headers: auth() });
    expect(check.status).toBe(404);
  });
});

// ── Files ─────────────────────────────────────────────────────────────

describe("files", () => {
  test("write and read file", async () => {
    // Write
    const writeRes = await fetch(api("/files?path=test-file.txt"), {
      method: "PUT",
      headers: auth({ "Content-Type": "application/octet-stream" }),
      body: "hello workspace",
    });
    expect(writeRes.status).toBe(204);

    // Read info
    const infoRes = await fetch(api("/files?path=test-file.txt"), {
      headers: auth(),
    });
    expect(infoRes.ok).toBe(true);

    // Read content
    const contentRes = await fetch(api("/files?path=test-file.txt&content=true"), {
      headers: auth(),
    });
    expect(contentRes.ok).toBe(true);
  });

  test("delete file", async () => {
    await fetch(api("/files?path=to-delete.txt"), {
      method: "PUT",
      headers: auth({ "Content-Type": "application/octet-stream" }),
      body: "temp",
    });
    const res = await fetch(api("/files?path=to-delete.txt"), {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(204);
  });

  test("read nonexistent file returns 404", async () => {
    const res = await fetch(api("/files?path=no-such-file.txt"), {
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });
});

// ── WebSocket: auth + topic_state ─────────────────────────────────────

describe("websocket", () => {
  test("connects, authenticates, receives topic_state", async () => {
    // Get events URL
    const topicRes = await fetch(api("/topics/main"), { headers: auth() });
    const topic = (await topicRes.json()) as any;
    const eventsURL = topic.events;
    expect(eventsURL).toBeDefined();

    const events: any[] = [];
    const ws = new WebSocket(eventsURL);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "authenticate", token: TOKEN }));
    };
    ws.onmessage = (ev) => {
      events.push(JSON.parse(String(ev.data)));
    };

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !events.some((e) => e.type === "topic_state")) {
      await Bun.sleep(100);
    }
    ws.close();

    expect(events.some((e) => e.type === "authenticated")).toBe(true);
    expect(events.some((e) => e.type === "connected")).toBe(true);
    const state = events.find((e) => e.type === "topic_state");
    expect(state).toBeDefined();
    expect(state.name).toBe("main");
  }, 15_000);

  test("rejects without auth", async () => {
    const topicRes = await fetch(api("/topics/main"), { headers: auth() });
    const topic = (await topicRes.json()) as any;
    const ws = new WebSocket(topic.events);

    const events: any[] = [];
    ws.onmessage = (ev) => events.push(JSON.parse(String(ev.data)));

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "submit_run", text: "hi" }));
    };

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && events.length === 0) {
      await Bun.sleep(100);
    }
    ws.close();

    expect(events.some((e) => e.type === "error")).toBe(true);
  }, 10_000);
});

// ── WebSocket: submit run + streaming ─────────────────────────────────

describe("run lifecycle", () => {
  test("submit prompt → running → assistant text → completed", async () => {
    const topicRes = await fetch(api("/topics/main"), { headers: auth() });
    const topic = (await topicRes.json()) as any;
    const ws = new WebSocket(topic.events);

    let authenticated = false;
    let connected = false;
    let sawRunning = false;
    let sawAssistant = false;
    let terminalState: string | null = null;
    const events: any[] = [];

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "authenticate", token: TOKEN }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      events.push(msg);

      if (msg.type === "authenticated") authenticated = true;
      if (msg.type === "connected") {
        connected = true;
        ws.send(JSON.stringify({ type: "submit_run", text: "respond with just the word OK" }));
      }
      if (msg.type === "run_updated" && msg.state === "running") sawRunning = true;
      if (msg.type === "run_updated" && ["completed", "cancelled", "failed"].includes(msg.state)) {
        terminalState = msg.state;
      }
      if (msg.type === "message" && msg.role === "assistant") sawAssistant = true;
    };

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !terminalState) {
      await Bun.sleep(250);
    }
    ws.close();

    expect(authenticated).toBe(true);
    expect(connected).toBe(true);
    expect(sawRunning).toBe(true);
    expect(terminalState).toBe("completed");
    expect(sawAssistant).toBe(true);
  }, 90_000);
});

// ── Queue operations ──────────────────────────────────────────────────

describe("queue", () => {
  let queueTopicName = "queue-test";

  beforeAll(async () => {
    await fetch(api("/topics"), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: queueTopicName }),
    });
  });

  test("submit multiple runs → first runs, rest queued", async () => {
    const topicRes = await fetch(api(`/topics/${queueTopicName}`), { headers: auth() });
    const topic = (await topicRes.json()) as any;
    const ws = new WebSocket(topic.events);

    let ready = false;
    const events: any[] = [];

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "authenticate", token: TOKEN }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      events.push(msg);
      if (msg.type === "connected") {
        ready = true;
        // Submit 3 runs quickly
        ws.send(JSON.stringify({ type: "submit_run", text: "first: say hello" }));
        ws.send(JSON.stringify({ type: "submit_run", text: "second: say world" }));
        ws.send(JSON.stringify({ type: "submit_run", text: "third: say bye" }));
      }
    };

    // Wait for first run to start
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !events.some((e) => e.type === "run_updated" && e.state === "running")) {
      await Bun.sleep(200);
    }

    // Check topic state — should have queued runs
    const stateRes = await fetch(api(`/topics/${queueTopicName}`), { headers: auth() });
    const state = (await stateRes.json()) as any;

    expect(state.activeRun).not.toBeNull();
    // Queue should have at least 1 entry (2nd and/or 3rd run)
    expect(state.queue.length).toBeGreaterThanOrEqual(1);

    ws.close();
  }, 45_000);
});

// ── Namespace events WebSocket ────────────────────────────────────────

describe("namespace events", () => {
  test("connects and receives workspace state", async () => {
    const wsURL = `${MANAGER.replace("http", "ws")}/apis/v1/namespaces/${namespace}/events`;
    const ws = new WebSocket(wsURL);

    const events: any[] = [];
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "authenticate", token: TOKEN }));
    };
    ws.onmessage = (ev) => {
      events.push(JSON.parse(String(ev.data)));
    };

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !events.some((e) => e.type === "connected")) {
      await Bun.sleep(100);
    }
    ws.close();

    expect(events.some((e) => e.type === "authenticated")).toBe(true);
    expect(events.some((e) => e.type === "connected")).toBe(true);
  }, 15_000);
});

/**
 * taskAI.test.js – Tests for:
 *   - createTaskFromMessage (channel + DM, permission checks)
 *   - updateTask
 *   - askTaskAI (read queries + write actions + unauthorized access + AI provider failure)
 *   - Regression: existing createTask, getWorkspaceTasks, updateTaskStatus
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NVIDIA_API_KEY = "test-nvidia-key";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");

// ─── Mock DB ──────────────────────────────────────────────────────────────────
const mockDbClient = {
  query: jest.fn(),
  execute: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

const mockDb = {
  promise: jest.fn(() => mockDbClient),
  query: jest.fn(),
  execute: jest.fn(),
  verifyConnection: jest.fn(),
  close: jest.fn(),
};

jest.mock("../config/db", () => mockDb);

// ─── Mock fetch (for NVIDIA API) ─────────────────────────────────────────────
global.fetch = jest.fn();

// ─── App setup ───────────────────────────────────────────────────────────────
const taskRoutes = require("../routes/taskRoutes");
const aiRoutes = require("../routes/aiRoutes");

const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/tasks", taskRoutes);
  app.use("/api/ai", aiRoutes);
  return app;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const tokenFor = (userId, name = "Pranit", role = "admin") =>
  jwt.sign(
    { user_id: userId, name, email: `${String(name).toLowerCase()}@test.com`, role },
    process.env.JWT_SECRET
  );

const rows = (rowArray) => [rowArray, []];

/** Queue multiple mockDbClient.query resolutions in order. */
const queueQueries = (...resultSets) => {
  resultSets.forEach((rs) => mockDbClient.query.mockResolvedValueOnce(rs));
};

const mockNvidiaSuccess = (content) => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  });
};

const mockNvidiaFailure = () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    text: async () => "Upstream error",
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── createTaskFromMessage ─────────────────────────────────────────────────────

describe("POST /api/tasks/create-from-message", () => {
  const app = buildApp();
  const token = tokenFor(1, "Alice");

  it("creates a task from a channel message (happy path)", async () => {
    queueQueries(
      // workspace membership check (creator)
      rows([{ member_id: 1 }]),
      // channel membership check
      rows([{ channel_id: 10 }]),
      // message existence check
      rows([{ message_id: 100 }]),
      // INSERT result
      [{ insertId: 55 }, []]
    );

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 1,
        title: "Fix login bug",
        description: "From channel message",
        priority: "high",
        source_message_id: 100,
        source_message_type: "channel",
        source_channel_id: 10,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.task.task_id).toBe(55);
    expect(res.body.task.source_message_type).toBe("channel");
  });

  it("creates a task from a DM message (happy path)", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),  // workspace membership
      rows([{ direct_message_id: 200 }]),  // DM access check
      [{ insertId: 56 }, []]
    );

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 1,
        title: "Review PR",
        source_message_id: 200,
        source_message_type: "dm",
        source_dm_user_id: 2,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.task.source_message_type).toBe("dm");
  });

  it("rejects if not a workspace member", async () => {
    queueQueries(rows([])); // no membership

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 99,
        title: "Sneaky task",
        source_message_id: 1,
        source_message_type: "channel",
        source_channel_id: 1,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("rejects if channel membership check fails", async () => {
    queueQueries(
      rows([{ member_id: 1 }]), // workspace member ✓
      rows([])  // channel access ✗
    );

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 1,
        title: "Task",
        source_message_id: 100,
        source_message_type: "channel",
        source_channel_id: 999,
      });

    expect(res.statusCode).toBe(403);
  });

  it("rejects if source message does not exist", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),   // workspace ✓
      rows([{ channel_id: 10 }]), // channel ✓
      rows([])                     // message not found
    );

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 1,
        title: "Task",
        source_message_id: 9999,
        source_message_type: "channel",
        source_channel_id: 10,
      });

    expect(res.statusCode).toBe(404);
  });

  it("rejects DM message not accessible by user", async () => {
    queueQueries(
      rows([{ member_id: 1 }]), // workspace ✓
      rows([])                   // DM access ✗
    );

    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        workspace_id: 1,
        title: "Task",
        source_message_id: 500,
        source_message_type: "dm",
        source_dm_user_id: 99,
      });

    expect(res.statusCode).toBe(403);
  });

  it("returns 400 if title is missing", async () => {
    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .set("Authorization", `Bearer ${token}`)
      .send({ workspace_id: 1, source_message_id: 1, source_message_type: "channel", source_channel_id: 1 });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await request(app)
      .post("/api/tasks/create-from-message")
      .send({ workspace_id: 1, title: "x", source_message_id: 1, source_message_type: "channel" });

    expect(res.statusCode).toBe(401);
  });
});

// ─── updateTask ───────────────────────────────────────────────────────────────

describe("PUT /api/tasks/update/:taskId", () => {
  const app = buildApp();
  const token = tokenFor(1, "Alice");

  it("updates priority of a task", async () => {
    queueQueries(
      rows([{ task_id: 10, workspace_id: 1 }]), // task lookup
      rows([{ member_id: 1 }]),                  // workspace membership
      [{ affectedRows: 1 }, []]                  // UPDATE
    );

    const res = await request(app)
      .put("/api/tasks/update/10")
      .set("Authorization", `Bearer ${token}`)
      .send({ priority: "high" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 if task not found", async () => {
    queueQueries(rows([]));

    const res = await request(app)
      .put("/api/tasks/update/999")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 if not a workspace member", async () => {
    queueQueries(
      rows([{ task_id: 10, workspace_id: 5 }]),
      rows([]) // not a member
    );

    const res = await request(app)
      .put("/api/tasks/update/10")
      .set("Authorization", `Bearer ${token}`)
      .send({ priority: "high" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid priority", async () => {
    queueQueries(
      rows([{ task_id: 10, workspace_id: 1 }]),
      rows([{ member_id: 1 }])
    );

    const res = await request(app)
      .put("/api/tasks/update/10")
      .set("Authorization", `Bearer ${token}`)
      .send({ priority: "critical" });

    expect(res.statusCode).toBe(400);
  });
});

// ─── askTaskAI – read queries ─────────────────────────────────────────────────

describe("POST /api/ai/ask-tasks – read queries", () => {
  const app = buildApp();
  const token = tokenFor(1, "Alice");

  const sampleTasks = [
    {
      task_id: 1, title: "Fix login bug", status: "pending", priority: "high",
      due_date: null, assigned_to: 1, assigned_to_name: "Alice",
      created_by: 1, created_by_name: "Alice", created_at: new Date().toISOString(),
    },
  ];

  it("answers a read query about tasks", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),    // workspace membership
      rows(sampleTasks),            // task fetch
      rows([{ name: "Alice" }])     // current user name
    );
    mockNvidiaSuccess("You have 1 pending task: Fix login bug (high priority).");

    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What are my pending tasks?", workspace_id: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.answer).toContain("pending");
    expect(res.body.action).toBeUndefined();
  });

  it("returns 403 if user is not a workspace member", async () => {
    queueQueries(rows([])); // not a member

    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Show tasks", workspace_id: 99 });

    expect(res.statusCode).toBe(403);
  });

  it("returns 400 if question is missing", async () => {
    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ workspace_id: 1 });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 if workspace_id is missing", async () => {
    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Show tasks" });

    expect(res.statusCode).toBe(400);
  });

  it("handles NVIDIA API failure gracefully", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),
      rows(sampleTasks),
      rows([{ name: "Alice" }])
    );
    mockNvidiaFailure();

    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Show tasks", workspace_id: 1 });

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── askTaskAI – write actions ────────────────────────────────────────────────

describe("POST /api/ai/ask-tasks – write action detection", () => {
  const app = buildApp();
  const token = tokenFor(1, "Alice");

  const sampleTasks = [
    { task_id: 5, title: "Deploy server", status: "pending", priority: "medium",
      due_date: null, assigned_to: null, assigned_to_name: null,
      created_by: 1, created_by_name: "Alice", created_at: new Date().toISOString() },
  ];

  it("detects a create action and returns preview without modifying DB", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),
      rows(sampleTasks),
      rows([{ name: "Alice" }])
    );

    const actionJSON = JSON.stringify({
      action: true,
      type: "create",
      task_id: null,
      fields: { title: "Fix login bug", priority: "high", assigned_to_name: "me" },
      preview: "Create task 'Fix login bug' with high priority, assigned to Alice.",
    });
    mockNvidiaSuccess(actionJSON);

    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Create a high priority task: Fix login bug, assign to me", workspace_id: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.action).toBeDefined();
    expect(res.body.action.type).toBe("create");
    expect(res.body.action.fields.title).toBe("Fix login bug");
    // "me" should be resolved to current user
    expect(res.body.action.fields.assigned_to_name).toBe("Alice");
    expect(res.body.action.fields._assigned_to_user_id).toBe(1);
    // DB should NOT have been called for INSERT (only 3 SELECT queries above)
    const insertCalls = mockDbClient.query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].trim().toUpperCase().startsWith('INSERT')
    );
    expect(insertCalls.length).toBe(0);
  });

  it("detects an update action and returns preview without modifying DB", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),
      rows(sampleTasks),
      rows([{ name: "Alice" }])
    );

    const actionJSON = JSON.stringify({
      action: true,
      type: "update",
      task_id: 5,
      fields: { status: "in_progress" },
      preview: "Move task #5 'Deploy server' to In Progress.",
    });
    mockNvidiaSuccess(actionJSON);

    const res = await request(app)
      .post("/api/ai/ask-tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Move task 5 to in progress", workspace_id: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.body.action.type).toBe("update");
    expect(res.body.action.task_id).toBe(5);
    expect(res.body.action.fields.status).toBe("in_progress");
  });
});

// ─── Regression: existing Channel/DM AI ──────────────────────────────────────

describe("POST /api/ai/ask – channel/DM AI regression", () => {
  const app = buildApp();
  const token = tokenFor(1, "Alice");

  it("still answers channel AI questions", async () => {
    queueQueries(
      rows([{ channel_id: 1, workspace_id: 1 }]), // channel membership
      rows([{ message_id: 1, message_text: "Hello", username: "Bob", created_at: new Date().toISOString() }]) // messages
    );
    mockNvidiaSuccess("The channel has a greeting from Bob.");

    const res = await request(app)
      .post("/api/ai/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Summarize", context_type: "channel", context_id: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.answer).toContain("Bob");
  });

  it("rejects unauthorized channel access", async () => {
    queueQueries(rows([])); // not a channel member

    const res = await request(app)
      .post("/api/ai/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Summarize", context_type: "channel", context_id: 99 });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Regression: existing task endpoints ─────────────────────────────────────

describe("Regression: existing task endpoints", () => {
  const app = buildApp();
  const adminToken = tokenFor(1, "Alice", "admin");
  const memberToken = tokenFor(2, "Bob", "member");

  it("GET /api/tasks/workspace/:id still works", async () => {
    queueQueries(
      rows([{ member_id: 1 }]),
      rows([{ task_id: 1, title: "Task A", status: "pending", priority: "medium",
               due_date: null, source_message_id: null, source_message_type: null,
               source_channel_id: null, source_dm_user_id: null,
               assigned_to: null, assigned_to_name: null, created_by: 1, created_by_name: "Alice",
               workspace_id: 1, created_at: new Date().toISOString() }])
    );

    const res = await request(app)
      .get("/api/tasks/workspace/1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tasks.length).toBe(1);
  });

  it("PUT /api/tasks/status/:taskId still works", async () => {
    queueQueries(
      rows([{ task_id: 1, workspace_id: 1 }]),
      rows([{ member_id: 1 }]),
      [{ affectedRows: 1 }, []]
    );

    const res = await request(app)
      .put("/api/tasks/status/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "completed" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── stripThinking unit tests ────────────────────────────────────────────────
describe("stripThinking cleaner", () => {
  const { stripThinking } = require("../controllers/aiController");

  it("strips XML think and thought tags", () => {
    const raw = "<think>I should calculate something</think>Hello world!";
    expect(stripThinking(raw)).toBe("Hello world!");
  });

  it("strips conversational chain-of-thought blocks", () => {
    const raw = `and tags, then final response. I'll reason that the user just said "hii", which is a greeting, not a question about the provided context.

Hello! How can I help you today?`;
    expect(stripThinking(raw)).toBe("Hello! How can I help you today?");
  });

  it("strips Thinking Process lead-ins", () => {
    const raw = `Here's a thinking process:
The user asks about blockers.

The current blocker is the database migration.`;
    expect(stripThinking(raw)).toBe("The current blocker is the database migration.");
  });

  it("extracts clean answer from numbered step reasoning traces", () => {
    const raw = `1.  Analyze User Input:
   - User wants: "summarize this convo"
2.  Review the Conversation Context:
   Let me list out all the messages in order:
   - [Pranit Gupta]: Hey team, we need to finalize the new landing page design by Friday.
3.  Identify the Main Purpose/Topics:
   - Landing page deadline
4.  Formulate a Concise Summary:
Possible summary:
   "Pranit Gupta shared that the team needs to finalize the new landing page design by Friday."
Check constraints:
   - Answer directly and concisely.`;
    expect(stripThinking(raw)).toBe("Pranit Gupta shared that the team needs to finalize the new landing page design by Friday.");
  });
});


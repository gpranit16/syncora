process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");

// Mocked DB client so the controllers never touch the real TiDB instance.
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

const db = require("../config/db");
const messageRoutes = require("../routes/messageRoutes");
const directMessageRoutes = require("../routes/directMessageRoutes");

const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/messages", messageRoutes);
  app.use("/api/direct-messages", directMessageRoutes);
  return app;
};

const tokenFor = (userId, name = "Pranit") =>
  jwt.sign(
    { user_id: userId, name, email: `${String(name).toLowerCase()}@test.com` },
    process.env.JWT_SECRET
  );

// Helper: queue mysql2-style results [rows, fields] for sequential queries.
const rows = (rowArray) => [rowArray, []];
const queueQueries = (...resultSets) => {
  resultSets.forEach((rs) => mockDbClient.query.mockResolvedValueOnce(rs));
};

describe("Message reactions API", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    mockDb.promise.mockReturnValue(mockDbClient);
  });

  // ---------- Authentication ----------
  test("rejects requests without a token (401)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .send({ emoji: "👍" });

    expect(res.status).toBe(401);
    expect(mockDbClient.query).not.toHaveBeenCalled();
  });

  test("rejects requests with an invalid token (401)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", "Bearer not-a-token")
      .send({ emoji: "👍" });

    expect(res.status).toBe(401);
  });

  // ---------- Validation ----------
  test("rejects an empty emoji (400)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockDbClient.query).not.toHaveBeenCalled();
  });

  test("rejects plain text without any emoji (400)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "abc" });

    expect(res.status).toBe(400);
    expect(mockDbClient.query).not.toHaveBeenCalled();
  });

  test("rejects an emoji longer than 32 characters (400)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍".repeat(33) });

    expect(res.status).toBe(400);
    expect(mockDbClient.query).not.toHaveBeenCalled();
  });

  test("rejects a missing emoji (400)", async () => {
    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(mockDbClient.query).not.toHaveBeenCalled();
  });

  // ---------- Missing / deleted messages ----------
  test("returns 404 when the message does not exist", async () => {
    queueQueries(rows([])); // getMessage finds nothing

    const res = await request(app)
      .put("/api/messages/999/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("returns 400 when reacting to a deleted message", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 1 }])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot react to a deleted message");
  });

  // ---------- Authorization ----------
  test("rejects a non-channel-member with 403", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([]) // no workspace membership
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(3)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(403);
  });

  // ---------- Toggle (add then remove on re-click) ----------
  test("adds a reaction and returns aggregated state", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]), // member
      rows([]), // no existing reaction
      rows([]), // INSERT
      rows([{ message_id: 10, emoji: "👍", count: 2 }]),
      rows([{ message_id: 10, emoji: "👍" }])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.added).toBe(true);
    expect(res.body.data.message_id).toBe(10);
    expect(res.body.data.reactions).toEqual([{ emoji: "👍", count: 2 }]);
    expect(res.body.data.my_reactions).toEqual(["👍"]);
  });

  test("accepts a custom emoji that is NOT in the default quick-pick set", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([]), // no existing reaction
      rows([]), // INSERT
      rows([{ message_id: 10, emoji: "🤑", count: 1 }]),
      rows([{ message_id: 10, emoji: "🤑" }])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "🤑" });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(true);
    expect(res.body.data.reactions).toEqual([{ emoji: "🤑", count: 1 }]);
  });

  test("accepts a multi-codepoint ZWJ emoji (emoji family)", async () => {
    const family = "👨\u200D👩\u200D👧\u200D👦";

    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([]), // no existing reaction
      rows([]), // INSERT
      rows([{ message_id: 10, emoji: family, count: 1 }]),
      rows([{ message_id: 10, emoji: family }])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: family });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(true);
    expect(res.body.data.reactions).toEqual([{ emoji: family, count: 1 }]);
  });

  test("removes the reaction when the same emoji is toggled again", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([{ reaction_id: 77 }]), // existing reaction
      rows([]), // DELETE
      rows([]), // summary after removal
      rows([])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(false);
    expect(res.body.data.reactions).toEqual([]);
    expect(res.body.data.my_reactions).toEqual([]);
  });

  test("treats a concurrent duplicate insert (ER_DUP_ENTRY) as success", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([]) // no existing reaction found
    );
    mockDbClient.query.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" }); // INSERT race
    queueQueries(
      rows([{ message_id: 10, emoji: "🚀", count: 1 }]),
      rows([{ message_id: 10, emoji: "🚀" }])
    );

    const res = await request(app)
      .put("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "🚀" });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(true);
  });

  // ---------- Explicit remove endpoint ----------
  test("removes an existing reaction via DELETE", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([{ reaction_id: 77 }]),
      rows([]), // DELETE
      rows([]),
      rows([])
    );

    const res = await request(app)
      .delete("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(false);
  });

  test("returns 404 when removing a reaction the user does not have", async () => {
    queueQueries(
      rows([{ message_id: 10, channel_id: 1, sender_id: 2, is_deleted: 0 }]),
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([]) // no such reaction
    );

    const res = await request(app)
      .delete("/api/messages/10/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👍" });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Reaction not found");
  });

  // ---------- Reactions with fetched messages ----------
  test("getChannelMessages includes aggregated reactions and my_reactions", async () => {
    queueQueries(
      rows([{ channel_id: 1, workspace_id: 1 }]),
      rows([
        { message_id: 10, channel_id: 1, sender_id: 2, message_text: "hi", sender_name: "A" },
        { message_id: 11, channel_id: 1, sender_id: 1, message_text: "yo", sender_name: "B" },
      ]),
      rows([
        { message_id: 10, emoji: "👍", count: 3 },
        { message_id: 10, emoji: "❤️", count: 1 },
        { message_id: 11, emoji: "😂", count: 2 },
      ]),
      rows([{ message_id: 11, emoji: "😂" }])
    );

    const res = await request(app)
      .get("/api/messages/channel/1")
      .set("Authorization", `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(200);
    const [first, second] = res.body.messages;
    expect(first.reactions).toEqual([
      { emoji: "👍", count: 3 },
      { emoji: "❤️", count: 1 },
    ]);
    expect(first.my_reactions).toEqual([]);
    expect(second.reactions).toEqual([{ emoji: "😂", count: 2 }]);
    expect(second.my_reactions).toEqual(["😂"]);
  });

  test("getChannelMessages returns empty reactions for an empty channel", async () => {
    queueQueries(rows([{ channel_id: 1, workspace_id: 1 }]), rows([]));

    const res = await request(app)
      .get("/api/messages/channel/1")
      .set("Authorization", `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    // Only membership + messages queries; no reaction aggregation needed
    expect(mockDbClient.query).toHaveBeenCalledTimes(2);
  });

  // ---------- Direct messages ----------
  test("DM participant can add a reaction to a direct message", async () => {
    queueQueries(
      rows([{ direct_message_id: 5, sender_id: 2, receiver_id: 1, is_deleted: 0 }]),
      rows([]), // no existing reaction
      rows([]), // INSERT
      rows([{ message_id: 5, emoji: "🎉", count: 1 }]),
      rows([{ message_id: 5, emoji: "🎉" }])
    );

    const res = await request(app)
      .put("/api/direct-messages/5/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "🎉" });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(true);
    expect(res.body.data.direct_message_id).toBe(5);
    expect(res.body.data.reactions).toEqual([{ emoji: "🎉", count: 1 }]);
    expect(res.body.data.my_reactions).toEqual(["🎉"]);
  });

  test("DM non-participant is rejected with 403", async () => {
    queueQueries(
      rows([{ direct_message_id: 5, sender_id: 2, receiver_id: 3, is_deleted: 0 }])
    );

    const res = await request(app)
      .put("/api/direct-messages/5/reactions")
      .set("Authorization", `Bearer ${tokenFor(4)}`)
      .send({ emoji: "👀" });

    expect(res.status).toBe(403);
  });

  test("deleted DM cannot be reacted to (400)", async () => {
    queueQueries(
      rows([{ direct_message_id: 5, sender_id: 2, receiver_id: 1, is_deleted: 1 }])
    );

    const res = await request(app)
      .put("/api/direct-messages/5/reactions")
      .set("Authorization", `Bearer ${tokenFor(1)}`)
      .send({ emoji: "👀" });

    expect(res.status).toBe(400);
  });
});

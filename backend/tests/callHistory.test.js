process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = "test";

const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

// In-memory mock database for call history
let mockDbMessages = [];
let mockUsers = [
  { user_id: 1, name: "Alice", email: "alice@example.com", is_online: 1, last_seen: null },
  { user_id: 2, name: "Bob", email: "bob@example.com", is_online: 1, last_seen: null },
  { user_id: 3, name: "Charlie", email: "charlie@example.com", is_online: 1, last_seen: null },
];

const mockQuery = jest.fn().mockImplementation((sql, params) => {
  const sqlStr = typeof sql === "string" ? sql : "";

  if (sqlStr.includes("SELECT user_id, name, email FROM users") || sqlStr.includes("FROM users")) {
    if (params && Array.isArray(params)) {
      const filtered = mockUsers.filter((u) => params.includes(u.user_id));
      return Promise.resolve([filtered, []]);
    }
    return Promise.resolve([mockUsers, []]);
  }

  if (sqlStr.includes("SELECT direct_message_id FROM direct_messages WHERE call_id =")) {
    const callId = params ? params[0] : null;
    const found = mockDbMessages.filter((m) => m.call_id === callId);
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("INSERT INTO direct_messages")) {
    const [sender_id, receiver_id, message_text, message_type, call_id, call_type, call_status, call_duration, is_read] = params;
    const newId = mockDbMessages.length + 1;
    const newMsg = {
      direct_message_id: newId,
      sender_id,
      receiver_id,
      message_text,
      message_type: message_type || "text",
      call_id: call_id || null,
      call_type: call_type || null,
      call_status: call_status || null,
      call_duration: call_duration || 0,
      is_read: Boolean(is_read),
      created_at: new Date(),
    };
    mockDbMessages.push(newMsg);
    return Promise.resolve([{ insertId: newId }, []]);
  }

  if (sqlStr.includes("SELECT") && sqlStr.includes("FROM direct_messages")) {
    return Promise.resolve([mockDbMessages, []]);
  }

  return Promise.resolve([[], []]);
});

const mockDb = {
  promise: jest.fn(() => ({
    query: mockQuery,
    execute: mockQuery,
  })),
  query: mockQuery,
  verifyConnection: jest.fn(),
  close: jest.fn(),
};

jest.mock("../config/db", () => mockDb);

const { recordCallHistory, formatCallMessageText } = require("../services/callHistoryService");
const chatSocket = require("../sockets/chatSocket");

const waitForEvent = (client, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs
    );
    client.once(event, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });

const connectClient = (client) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting")), 5000);
    client.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

const waitForRoom = async (ioServer, room, size) => {
  for (let i = 0; i < 100; i += 1) {
    const sockets = await ioServer.in(room).allSockets();
    if (sockets.size >= size) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for room ${room}`);
};

describe("Persistent 1-to-1 DM Call History", () => {
  let httpServer;
  let ioServer;
  let url;

  beforeAll((done) => {
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { cors: { origin: "*" } });
    chatSocket(ioServer);
    httpServer.listen(0, () => {
      url = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    ioServer.close();
    httpServer.close(() => done());
  });

  beforeEach(() => {
    mockDbMessages = [];
  });

  describe("formatCallMessageText", () => {
    test("formats completed voice and video calls with duration", () => {
      expect(formatCallMessageText("voice", "completed", 154)).toBe("Voice call (2 min 34 sec)");
      expect(formatCallMessageText("video", "completed", 45)).toBe("Video call (45 sec)");
    });

    test("formats missed calls", () => {
      expect(formatCallMessageText("voice", "missed", 0)).toBe("Missed voice call");
      expect(formatCallMessageText("video", "missed", 0)).toBe("Missed video call");
    });

    test("formats rejected calls", () => {
      expect(formatCallMessageText("voice", "rejected", 0)).toBe("Voice call declined");
      expect(formatCallMessageText("video", "rejected", 0)).toBe("Video call declined");
    });

    test("formats cancelled and failed calls", () => {
      expect(formatCallMessageText("voice", "cancelled", 0)).toBe("Cancelled voice call");
      expect(formatCallMessageText("video", "failed", 0)).toBe("Video call failed");
    });
  });

  describe("recordCallHistory Service", () => {
    test("creates completed call history entry and emits receive_dm event", async () => {
      const entry = await recordCallHistory({
        callId: "call_test_101",
        callerId: 1,
        receiverId: 2,
        callType: "voice",
        callStatus: "completed",
        duration: 125,
        io: ioServer,
      });

      expect(entry).not.toBeNull();
      expect(entry.call_id).toBe("call_test_101");
      expect(entry.message_type).toBe("call");
      expect(entry.call_type).toBe("voice");
      expect(entry.call_status).toBe("completed");
      expect(entry.call_duration).toBe(125);
      expect(entry.sender_name).toBe("Alice");
      expect(entry.receiver_name).toBe("Bob");

      expect(mockDbMessages.length).toBe(1);
      expect(mockDbMessages[0].call_id).toBe("call_test_101");
    });

    test("idempotent: does not insert duplicate record for same callId", async () => {
      await recordCallHistory({
        callId: "call_duplicate_test",
        callerId: 1,
        receiverId: 2,
        callType: "video",
        callStatus: "completed",
        duration: 60,
      });

      expect(mockDbMessages.length).toBe(1);

      // Attempt second insertion for identical callId
      const secondAttempt = await recordCallHistory({
        callId: "call_duplicate_test",
        callerId: 1,
        receiverId: 2,
        callType: "video",
        callStatus: "completed",
        duration: 60,
      });

      expect(secondAttempt).toBeNull();
      expect(mockDbMessages.length).toBe(1);
    });
  });

  describe("Realtime Socket Call Lifecycle History Integration", () => {
    test("completed voice call creates history entry when ended", async () => {
      const caller = Client(url, { transports: ["websocket"] });
      const receiver = Client(url, { transports: ["websocket"] });

      await Promise.all([connectClient(caller), connectClient(receiver)]);

      caller.emit("user_online", 1);
      caller.emit("join_user_room", 1);
      caller.emit("join_dm", { sender_id: 1, receiver_id: 2 });

      receiver.emit("user_online", 2);
      receiver.emit("join_user_room", 2);
      receiver.emit("join_dm", { sender_id: 2, receiver_id: 1 });

      await waitForRoom(ioServer, "user_1", 1);
      await waitForRoom(ioServer, "user_2", 1);

      const incomingPromise = waitForEvent(receiver, "incoming_call");

      caller.emit("call_user", {
        receiver_id: 2,
        call_type: "voice",
        offer: { type: "offer", sdp: "dummy" },
      });

      const incoming = await incomingPromise;

      // Receiver accepts
      receiver.emit("call_accept", {
        call_id: incoming.call_id,
        answer: { type: "answer", sdp: "dummy" },
      });

      // Wait a tick then caller ends call
      await new Promise((r) => setTimeout(r, 100));

      const receiverDmPromise = waitForEvent(receiver, "receive_dm");
      const callerDmPromise = waitForEvent(caller, "receive_dm");

      caller.emit("call_end", {
        call_id: incoming.call_id,
        target_user_id: 2,
        reason: "hung_up",
      });

      const [receiverDm, callerDm] = await Promise.all([receiverDmPromise, callerDmPromise]);

      expect(receiverDm.message_type).toBe("call");
      expect(receiverDm.call_type).toBe("voice");
      expect(receiverDm.call_status).toBe("completed");
      expect(receiverDm.call_id).toBe(incoming.call_id);

      expect(callerDm.call_id).toBe(incoming.call_id);
      expect(callerDm.call_status).toBe("completed");

      caller.disconnect();
      receiver.disconnect();
    });

    test("rejected voice call creates rejected history entry", async () => {
      const caller = Client(url, { transports: ["websocket"] });
      const receiver = Client(url, { transports: ["websocket"] });

      await Promise.all([connectClient(caller), connectClient(receiver)]);

      caller.emit("user_online", 1);
      caller.emit("join_user_room", 1);
      receiver.emit("user_online", 2);
      receiver.emit("join_user_room", 2);

      await waitForRoom(ioServer, "user_1", 1);
      await waitForRoom(ioServer, "user_2", 1);

      const incomingPromise = waitForEvent(receiver, "incoming_call");

      caller.emit("call_user", {
        receiver_id: 2,
        call_type: "video",
        offer: { type: "offer", sdp: "dummy" },
      });

      const incoming = await incomingPromise;

      const receiverDmPromise = waitForEvent(receiver, "receive_dm");
      const callerDmPromise = waitForEvent(caller, "receive_dm");

      receiver.emit("call_reject", {
        call_id: incoming.call_id,
        reason: "declined",
      });

      const [receiverDm, callerDm] = await Promise.all([receiverDmPromise, callerDmPromise]);

      expect(receiverDm.message_type).toBe("call");
      expect(receiverDm.call_type).toBe("video");
      expect(receiverDm.call_status).toBe("rejected");
      expect(receiverDm.message_text).toBe("Video call declined");

      expect(callerDm.call_id).toBe(incoming.call_id);
      expect(callerDm.call_status).toBe("rejected");

      caller.disconnect();
      receiver.disconnect();
    });

    test("caller cancel while ringing creates cancelled/missed history entry", async () => {
      const caller = Client(url, { transports: ["websocket"] });
      const receiver = Client(url, { transports: ["websocket"] });

      await Promise.all([connectClient(caller), connectClient(receiver)]);

      caller.emit("user_online", 1);
      caller.emit("join_user_room", 1);
      receiver.emit("user_online", 2);
      receiver.emit("join_user_room", 2);

      await waitForRoom(ioServer, "user_1", 1);
      await waitForRoom(ioServer, "user_2", 1);

      const incomingPromise = waitForEvent(receiver, "incoming_call");

      caller.emit("call_user", {
        receiver_id: 2,
        call_type: "voice",
        offer: { type: "offer", sdp: "dummy" },
      });

      const incoming = await incomingPromise;

      const receiverDmPromise = waitForEvent(receiver, "receive_dm");

      // Caller hangs up without receiver accepting
      caller.emit("call_end", {
        call_id: incoming.call_id,
        target_user_id: 2,
        reason: "hung_up",
      });

      const receiverDm = await receiverDmPromise;

      expect(receiverDm.message_type).toBe("call");
      expect(receiverDm.call_type).toBe("voice");
      expect(receiverDm.call_status).toBe("cancelled");

      caller.disconnect();
      receiver.disconnect();
    });
  });
});

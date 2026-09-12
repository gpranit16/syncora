process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

const mockQuery = jest.fn().mockImplementation((sql, params) => {
  const sqlStr = typeof sql === "string" ? sql : "";
  if (sqlStr.includes("FROM users")) {
    return Promise.resolve([
      [
        { user_id: 1, name: "Alice", avatar: null },
        { user_id: 2, name: "Bob", avatar: null }
      ],
      []
    ]);
  }
  if (sqlStr.includes("INSERT INTO direct_messages")) {
    return Promise.resolve([{ insertId: 1 }, []]);
  }
  return Promise.resolve([[], []]);
});

// Mock DB
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

describe("1-to-1 WebRTC Call Signaling (Socket.io)", () => {
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
    mockQuery.mockImplementation((sql) => {
      const sqlStr = typeof sql === "string" ? sql : "";
      if (sqlStr.includes("FROM users")) {
        return Promise.resolve([
          [
            { user_id: 1, name: "Alice", avatar: null },
            { user_id: 2, name: "Bob", avatar: null }
          ],
          []
        ]);
      }
      if (sqlStr.includes("INSERT INTO direct_messages")) {
        return Promise.resolve([{ insertId: 1 }, []]);
      }
      return Promise.resolve([[], []]);
    });
  });

  test("call_user sends incoming_call to receiver and call_ringing to caller", async () => {
    const caller = Client(url, { transports: ["websocket"] });
    const receiver = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(caller), connectClient(receiver)]);

    // Set online and join user rooms
    caller.emit("user_online", 1);
    caller.emit("join_user_room", 1);
    receiver.emit("user_online", 2);
    receiver.emit("join_user_room", 2);

    await waitForRoom(ioServer, "user_1", 1);
    await waitForRoom(ioServer, "user_2", 1);

    const incomingPromise = waitForEvent(receiver, "incoming_call");
    const ringingPromise = waitForEvent(caller, "call_ringing");

    caller.emit("call_user", {
      receiver_id: 2,
      call_type: "video",
      offer: { type: "offer", sdp: "dummy-sdp-offer" }
    });

    const [incomingData, ringingData] = await Promise.all([incomingPromise, ringingPromise]);

    expect(incomingData.caller.user_id).toBe(1);
    expect(incomingData.caller.name).toBe("Alice");
    expect(incomingData.call_type).toBe("video");
    expect(incomingData.offer).toEqual({ type: "offer", sdp: "dummy-sdp-offer" });

    expect(ringingData.receiver.user_id).toBe(2);
    expect(ringingData.call_type).toBe("video");
    expect(ringingData.call_id).toBe(incomingData.call_id);

    caller.disconnect();
    receiver.disconnect();
  });

  test("call_accept notifies caller that call was accepted with SDP answer", async () => {
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
      offer: { type: "offer", sdp: "offer-sdp" }
    });

    const incomingData = await incomingPromise;

    const acceptedPromise = waitForEvent(caller, "call_accepted");

    receiver.emit("call_accept", {
      call_id: incomingData.call_id,
      answer: { type: "answer", sdp: "answer-sdp" }
    });

    const acceptedData = await acceptedPromise;

    expect(acceptedData.call_id).toBe(incomingData.call_id);
    expect(acceptedData.receiver_id).toBe(2);
    expect(acceptedData.answer).toEqual({ type: "answer", sdp: "answer-sdp" });

    caller.disconnect();
    receiver.disconnect();
  });

  test("call_reject notifies caller that call was declined", async () => {
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
      call_type: "voice"
    });

    const incomingData = await incomingPromise;

    const rejectedPromise = waitForEvent(caller, "call_rejected");

    receiver.emit("call_reject", {
      call_id: incomingData.call_id,
      reason: "declined"
    });

    const rejectedData = await rejectedPromise;

    expect(rejectedData.call_id).toBe(incomingData.call_id);
    expect(rejectedData.reason).toBe("declined");

    caller.disconnect();
    receiver.disconnect();
  });

  test("webrtc_signal relays ICE candidates between users", async () => {
    const caller = Client(url, { transports: ["websocket"] });
    const receiver = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(caller), connectClient(receiver)]);

    caller.emit("user_online", 1);
    caller.emit("join_user_room", 1);
    receiver.emit("user_online", 2);
    receiver.emit("join_user_room", 2);

    await waitForRoom(ioServer, "user_1", 1);
    await waitForRoom(ioServer, "user_2", 1);

    const signalPromise = waitForEvent(receiver, "webrtc_signal");

    caller.emit("webrtc_signal", {
      call_id: "call_1_2_test",
      target_user_id: 2,
      signal: {
        type: "ice-candidate",
        candidate: { candidate: "dummy-candidate", sdpMid: "0", sdpMLineIndex: 0 }
      }
    });

    const signalData = await signalPromise;

    expect(signalData.from_user_id).toBe(1);
    expect(signalData.call_id).toBe("call_1_2_test");
    expect(signalData.signal.type).toBe("ice-candidate");
    expect(signalData.signal.candidate.candidate).toBe("dummy-candidate");

    caller.disconnect();
    receiver.disconnect();
  });

  test("call_end emits call_ended to remote peer and caller", async () => {
    const caller = Client(url, { transports: ["websocket"] });
    const receiver = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(caller), connectClient(receiver)]);

    caller.emit("user_online", 1);
    caller.emit("join_user_room", 1);
    receiver.emit("user_online", 2);
    receiver.emit("join_user_room", 2);

    await waitForRoom(ioServer, "user_1", 1);
    await waitForRoom(ioServer, "user_2", 1);

    const endedPromise = waitForEvent(receiver, "call_ended");

    caller.emit("call_end", {
      call_id: "call_1_2_end",
      target_user_id: 2,
      reason: "hung_up"
    });

    const endedData = await endedPromise;

    expect(endedData.call_id).toBe("call_1_2_end");
    expect(endedData.reason).toBe("hung_up");

    caller.disconnect();
    receiver.disconnect();
  });

  test("disconnecting user in an active call alerts other peer with call_ended", async () => {
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
      call_type: "voice"
    });

    const incomingData = await incomingPromise;

    // Caller suddenly disconnects
    const endedPromise = waitForEvent(receiver, "call_ended");
    caller.disconnect();

    const endedData = await endedPromise;
    expect(endedData.call_id).toBe(incomingData.call_id);
    expect(endedData.reason).toBe("disconnected");

    receiver.disconnect();
  });

  test("unauthenticated call_user emits call_error", async () => {
    const unauthClient = Client(url, { transports: ["websocket"] });
    await connectClient(unauthClient);

    const errorPromise = waitForEvent(unauthClient, "call_error");

    unauthClient.emit("call_user", {
      receiver_id: 2,
      call_type: "voice"
    });

    const errorData = await errorPromise;
    expect(errorData.message).toContain("Unauthorized");

    unauthClient.disconnect();
  });
});

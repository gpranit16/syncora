process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

// Mocked DB so chatSocket.js can be loaded without touching TiDB.
const mockDb = {
  promise: jest.fn(() => ({
    query: jest.fn(),
    execute: jest.fn(),
  })),
  query: jest.fn(),
  verifyConnection: jest.fn(),
  close: jest.fn(),
};

jest.mock("../config/db", () => mockDb);

const chatSocket = require("../sockets/chatSocket");

const waitForEvent = (client, event) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      5000
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

describe("Realtime reaction broadcasts (Socket.io)", () => {
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

  test("broadcasts reaction_added to everyone in the channel room", async () => {
    const clientA = Client(url, { transports: ["websocket"] });
    const clientB = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(clientA), connectClient(clientB)]);
    clientA.emit("join_channel", 1);
    clientB.emit("join_channel", 1);
    await waitForRoom(ioServer, "channel_1", 2);

    const payload = {
      message_id: 10,
      channel_id: 1,
      emoji: "👍",
      user_id: 1,
    };

    const received = waitForEvent(clientB, "reaction_added");
    clientA.emit("reaction_added", payload);
    const data = await received;

    expect(data).toEqual(payload);

    clientA.disconnect();
    clientB.disconnect();
  });

  test("broadcasts reaction_removed to everyone in the channel room", async () => {
    const clientA = Client(url, { transports: ["websocket"] });
    const clientB = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(clientA), connectClient(clientB)]);
    clientA.emit("join_channel", 2);
    clientB.emit("join_channel", 2);
    await waitForRoom(ioServer, "channel_2", 2);

    const payload = {
      message_id: 11,
      channel_id: 2,
      emoji: "🎉",
      user_id: 2,
    };

    const received = waitForEvent(clientB, "reaction_removed");
    clientA.emit("reaction_removed", payload);
    const data = await received;

    expect(data).toEqual(payload);

    clientA.disconnect();
    clientB.disconnect();
  });

  test("broadcasts DM reactions to the DM room", async () => {
    const clientA = Client(url, { transports: ["websocket"] });
    const clientB = Client(url, { transports: ["websocket"] });

    await Promise.all([connectClient(clientA), connectClient(clientB)]);
    clientA.emit("join_dm", { senderId: 5, receiverId: 6 });
    clientB.emit("join_dm", { senderId: 5, receiverId: 6 });
    await waitForRoom(ioServer, "dm_5_6", 2);

    const payload = {
      direct_message_id: 42,
      sender_id: 5,
      receiver_id: 6,
      emoji: "❤️",
      user_id: 5,
    };

    const received = waitForEvent(clientB, "reaction_added");
    clientA.emit("reaction_added", payload);
    const data = await received;

    expect(data).toEqual(payload);

    clientA.disconnect();
    clientB.disconnect();
  });

  test("ignores malformed reaction payloads", async () => {
    const clientA = Client(url, { transports: ["websocket"] });
    await connectClient(clientA);

    // Should not throw / crash the server
    clientA.emit("reaction_added", null);
    clientA.emit("reaction_added", "garbage");
    clientA.emit("reaction_removed", { emoji: "👍" });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ioServer.engine.clientsCount).toBeGreaterThan(0);

    clientA.disconnect();
  });
});

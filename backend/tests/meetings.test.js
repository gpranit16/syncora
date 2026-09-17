process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = "test";

const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const jwt = require("jsonwebtoken");

// Mock DB
let mockMeetings = [];
let mockParticipants = [];
let mockWorkspaces = [
  { workspace_id: 1, name: "Workspace 1" }
];
let mockWorkspaceMembers = [
  { workspace_id: 1, user_id: 1, role: "admin" },
  { workspace_id: 1, user_id: 2, role: "member" },
];
let mockUsers = [
  { user_id: 1, name: "Alice", email: "alice@example.com" },
  { user_id: 2, name: "Bob", email: "bob@example.com" },
];

const mockQuery = jest.fn().mockImplementation((sql, params) => {
  const sqlStr = typeof sql === "string" ? sql : "";

  if (sqlStr.includes("FROM workspace_members WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const found = mockWorkspaceMembers.filter(m => m.workspace_id === Number(wId) && m.user_id === Number(uId));
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("INSERT INTO meetings")) {
    const [meeting_code, workspace_id, channel_id, host_id, title, mode] = params;
    const newId = mockMeetings.length + 1;
    const meeting = {
      meeting_id: newId,
      workspace_id: workspace_id ? Number(workspace_id) : null,
      channel_id: channel_id ? Number(channel_id) : null,
      host_id: Number(host_id),
      host_user_id: Number(host_id),
      title: title || "Syncora Meeting",
      mode: mode || "video",
      meeting_type: mode || "video",
      meeting_code,
      status: "active",
      created_at: new Date(),
      ended_at: null,
    };
    mockMeetings.push(meeting);
    return Promise.resolve([{ insertId: newId }, []]);
  }

  if (sqlStr.includes("INSERT INTO meeting_participants")) {
    const [meeting_id, user_id, role, is_muted, is_camera_off] = params;
    const newId = mockParticipants.length + 1;
    const participant = {
      participant_id: newId,
      meeting_id: Number(meeting_id),
      user_id: Number(user_id),
      role,
      status: "active",
      is_muted: is_muted ? 1 : 0,
      is_camera_off: is_camera_off ? 1 : 0,
      joined_at: new Date(),
      left_at: null,
    };
    mockParticipants.push(participant);
    return Promise.resolve([{ insertId: newId }, []]);
  }

  if (sqlStr.includes("SELECT * FROM meetings WHERE meeting_code = ?")) {
    const code = params[0];
    const found = mockMeetings.filter(m => m.meeting_code === code);
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("SELECT") && sqlStr.includes("FROM meetings m") && sqlStr.includes("WHERE m.meeting_code = ?")) {
    const code = params[0];
    const found = mockMeetings
      .filter(m => m.meeting_code === code)
      .map(m => {
        const host = mockUsers.find(u => u.user_id === m.host_user_id) || {};
        return {
          ...m,
          host_name: host.name || "Host",
          host_email: host.email || "host@example.com",
          host_avatar: null,
          channel_name: m.channel_id ? "general" : null,
          workspace_name: "Workspace 1",
        };
      });
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("SELECT") && sqlStr.includes("FROM meeting_participants mp") && sqlStr.includes("WHERE mp.meeting_id = ?")) {
    const meetingId = params[0];
    const found = mockParticipants
      .filter(p => p.meeting_id === Number(meetingId))
      .map(p => {
        const user = mockUsers.find(u => u.user_id === p.user_id) || {};
        return {
          ...p,
          user_name: user.name || "User",
          user_avatar: null,
          email: user.email || "user@example.com",
        };
      });
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("UPDATE meetings SET status = 'ended'")) {
    const code = params[0];
    const m = mockMeetings.find(item => item.meeting_code === code);
    if (m) {
      m.status = "ended";
      m.ended_at = new Date();
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  }

  if (sqlStr.includes("UPDATE meeting_participants SET status = 'left'")) {
    const meetingId = params[0];
    mockParticipants.forEach(p => {
      if (p.meeting_id === Number(meetingId) && !p.left_at) {
        p.status = "left";
        p.left_at = new Date();
      }
    });
    return Promise.resolve([{ affectedRows: 1 }, []]);
  }

  if (sqlStr.includes("FROM channels c") && sqlStr.includes("workspace_members wm")) {
    const uId = params[0];
    const cId = params[1];
    // channel 1 belongs to workspace 1, Alice(1) and Bob(2) are members. User 99 is not.
    if (Number(cId) === 1 && (Number(uId) === 1 || Number(uId) === 2)) {
      return Promise.resolve([[{ channel_id: 1, workspace_id: 1 }], []]);
    }
    return Promise.resolve([[], []]);
  }

  if (sqlStr.includes("SELECT * FROM meetings WHERE channel_id = ? AND status = 'active'")) {
    const [cId] = params;
    const found = mockMeetings.filter(m => m.channel_id === Number(cId) && m.status === 'active');
    return Promise.resolve([found, []]);
  }

  if (sqlStr.includes("FROM meetings m") && sqlStr.includes("WHERE m.channel_id = ? AND m.status = 'active'")) {
    const [cId] = params;
    const found = mockMeetings
      .filter(m => m.channel_id === Number(cId) && m.status === 'active')
      .map(m => {
        const host = mockUsers.find(u => u.user_id === m.host_user_id) || {};
        return {
          ...m,
          host_name: host.name || "Host",
          host_email: host.email || "host@example.com",
          host_avatar: null,
          channel_name: "general",
          workspace_name: "Workspace 1",
        };
      });
    return Promise.resolve([found, []]);
  }

  return Promise.resolve([[], []]);
});

const mockDb = {
  promise: () => ({
    query: mockQuery,
  }),
};

jest.mock("../config/db", () => mockDb);

const express = require("express");
const meetingRoutes = require("../routes/meetingRoutes");
const { meetingSocket } = require("../sockets/meetingSocket");

describe("Meeting API and Sockets", () => {
  let app;
  let server;
  let io;
  let port;
  let aliceToken;
  let bobToken;

  beforeAll((done) => {
    aliceToken = jwt.sign({ user_id: 1, email: "alice@example.com" }, process.env.JWT_SECRET);
    bobToken = jwt.sign({ user_id: 2, email: "bob@example.com" }, process.env.JWT_SECRET);

    app = express();
    app.use(express.json());
    app.use("/api/meetings", meetingRoutes);

    server = http.createServer(app);
    io = new Server(server);
    app.set("io", io);

    const onlineUsers = new Map();
    io.on("connection", (socket) => {
      meetingSocket(io, socket, onlineUsers);
      socket.on("user_online", (userId) => onlineUsers.set(socket.id, userId));
    });

    server.listen(() => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    server.close(done);
  });

  beforeEach(() => {
    mockMeetings = [];
    mockParticipants = [];
    jest.clearAllMocks();
  });

  test("POST /api/meetings - Creates meeting successfully with valid code", async () => {
    const request = require("supertest");
    const res = await request(app)
      .post("/api/meetings")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        title: "Sprint Review",
        meeting_type: "video",
        workspace_id: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.meeting_code).toMatch(/^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}$/);
    expect(res.body.data.title).toBe("Sprint Review");
    expect(res.body.data.host_user_id).toBe(1);
    expect(res.body.data.meeting_type).toBe("video");
  });

  test("GET /api/meetings/code/:meetingCode - Retrieves meeting details", async () => {
    const request = require("supertest");
    // First create
    const createRes = await request(app)
      .post("/api/meetings")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        title: "Daily Standup",
        meeting_type: "voice",
        workspace_id: 1,
      });

    const code = createRes.body.data.meeting_code;

    const getRes = await request(app)
      .get(`/api/meetings/code/${code}`)
      .set("Authorization", `Bearer ${bobToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.meeting_code).toBe(code);
    expect(getRes.body.data.meeting_type).toBe("voice");
  });

  test("GET /api/meetings/channel/:channelId/active - Retrieves active meeting in channel", async () => {
    const request = require("supertest");
    // Create an active meeting in channel 1
    const createRes = await request(app)
      .post("/api/meetings")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        title: "Channel Sprint Sync",
        meeting_type: "video",
        workspace_id: 1,
        channel_id: 1,
      });

    expect(createRes.status).toBe(201);
    const createdCode = createRes.body.data.meeting_code;

    // Bob queries channel 1 active meeting
    const res = await request(app)
      .get("/api/meetings/channel/1/active")
      .set("Authorization", `Bearer ${bobToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.meeting_code).toBe(createdCode);
    expect(res.body.data.title).toBe("Channel Sprint Sync");
  });

  test("GET /api/meetings/channel/:channelId/active - Returns 403 for unauthorized channel access", async () => {
    const request = require("supertest");
    const intruderToken = jwt.sign({ user_id: 99, email: "intruder@example.com" }, process.env.JWT_SECRET);

    const res = await request(app)
      .get("/api/meetings/channel/1/active")
      .set("Authorization", `Bearer ${intruderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("Duplicate active meeting prevention in the same channel", async () => {
    const request = require("supertest");
    // Alice creates meeting in channel 1
    const res1 = await request(app)
      .post("/api/meetings")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        title: "First Meeting",
        meeting_type: "video",
        workspace_id: 1,
        channel_id: 1,
      });
    expect(res1.status).toBe(201);
    const firstCode = res1.body.data.meeting_code;

    // Alice or Bob attempts to create another meeting in channel 1
    const res2 = await request(app)
      .post("/api/meetings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({
        title: "Second Meeting Attempt",
        meeting_type: "voice",
        workspace_id: 1,
        channel_id: 1,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
    // Returns existing meeting
    expect(res2.body.data.meeting_code).toBe(firstCode);
    expect(mockMeetings.filter(m => m.channel_id === 1 && m.status === "active").length).toBe(1);
  });

  test("Socket WebRTC Signaling and Participant Flow", (done) => {
    // Create meeting in mock
    mockMeetings.push({
      meeting_id: 10,
      workspace_id: 1,
      channel_id: null,
      host_user_id: 1,
      title: "Team Sync",
      meeting_type: "video",
      meeting_code: "abc-def-ghi",
      status: "active",
      created_at: new Date(),
      ended_at: null,
    });

    const clientAlice = Client(`http://localhost:${port}`);
    const clientBob = Client(`http://localhost:${port}`);

    clientAlice.on("connect", () => {
      clientAlice.emit("user_online", 1);
      clientAlice.emit("meeting_join", {
        meeting_code: "abc-def-ghi",
        user_id: 1,
        user_name: "Alice",
      });
    });

    clientAlice.on("meeting_joined_success", (data) => {
      expect(data.meeting.meeting_code).toBe("abc-def-ghi");
      expect(data.meeting.role).toBe("host");

      // Bob connects and joins
      clientBob.emit("user_online", 2);
      clientBob.emit("meeting_join", {
        meeting_code: "abc-def-ghi",
        user_id: 2,
        user_name: "Bob",
      });
    });

    clientAlice.on("meeting_user_joined", (userJoined) => {
      expect(userJoined.user_id).toBe(2);
      expect(userJoined.user_name).toBe("Bob");

      // Alice sends signaling offer to Bob
      clientAlice.emit("meeting_signal", {
        meeting_code: "abc-def-ghi",
        target_socket_id: userJoined.socket_id,
        signal: { type: "offer", sdp: "mock-sdp-offer" },
      });
    });

    clientBob.on("meeting_signal", (signalData) => {
      expect(signalData.signal.type).toBe("offer");
      expect(signalData.signal.sdp).toBe("mock-sdp-offer");
      expect(signalData.sender_user_id).toBe(1);

      // Cleanup
      clientAlice.disconnect();
      clientBob.disconnect();
      done();
    });
  });

  test("Socket Screen Share and In-Meeting Chat Flow", (done) => {
    mockMeetings.push({
      meeting_id: 101,
      workspace_id: 1,
      host_user_id: 1,
      title: "Screen Share & Chat Test",
      meeting_type: "video",
      meeting_code: "xyz-123-789",
      status: "active",
      created_at: new Date(),
      ended_at: null,
    });

    const clientAlice = Client(`http://localhost:${port}`);
    const clientBob = Client(`http://localhost:${port}`);

    clientAlice.on("connect", () => {
      clientAlice.emit("user_online", 1);
      clientAlice.emit("meeting_join", {
        meeting_code: "xyz-123-789",
        user_id: 1,
        user_name: "Alice",
      });
    });

    clientAlice.on("meeting_joined_success", () => {
      clientBob.emit("user_online", 2);
      clientBob.emit("meeting_join", {
        meeting_code: "xyz-123-789",
        user_id: 2,
        user_name: "Bob",
      });
    });

    clientBob.on("meeting_joined_success", (data) => {
      expect(data.meeting.meeting_code).toBe("xyz-123-789");
      expect(data.chat_history).toEqual([]);

      // Bob starts screen sharing
      clientBob.emit("meeting_screen_share_status", {
        meeting_code: "xyz-123-789",
        is_sharing: true,
      });
    });

    clientAlice.on("meeting_screen_share_status", (shareStatus) => {
      if (shareStatus.is_sharing) {
        expect(shareStatus.user_id).toBe(2);
        expect(shareStatus.user_name).toBe("Bob");

        // Alice (Host) tests in-meeting chat
        clientAlice.emit("meeting_send_message", {
          meeting_code: "xyz-123-789",
          message: "Hello team! Can you see Bob's screen?",
        });
      }
    });

    clientBob.on("meeting_new_message", (msg) => {
      expect(msg.sender_id).toBe(1);
      expect(msg.sender_name).toBe("Alice");
      expect(msg.is_host).toBe(true);
      expect(msg.text).toBe("Hello team! Can you see Bob's screen?");

      // Alice (Host) stops Bob's screen share
      clientAlice.emit("meeting_stop_screen_share", {
        meeting_code: "xyz-123-789",
        target_socket_id: clientBob.id,
      });
    });

    clientBob.on("meeting_force_stop_screen_share", (stopData) => {
      expect(stopData.by_user_id).toBe(1);

      clientAlice.disconnect();
      clientBob.disconnect();
      done();
    });
  });
});


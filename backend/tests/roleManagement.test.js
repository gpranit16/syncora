process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = "test";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

let mockWorkspaceMembers = [
  { workspace_id: 1, user_id: 1, role: "owner" },
  { workspace_id: 1, user_id: 2, role: "admin" },
  { workspace_id: 1, user_id: 3, role: "member" },
];

let mockBannedUsers = [];
let mockChannels = [
  { channel_id: 1, workspace_id: 1, name: "general" }
];

const mockQuery = jest.fn().mockImplementation((sql, params) => {
  const sqlStr = typeof sql === "string" ? sql : "";

  // Check workspace membership
  if (sqlStr.includes("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?") ||
      sqlStr.includes("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const found = mockWorkspaceMembers.filter(
      (m) => m.workspace_id === Number(wId) && m.user_id === Number(uId)
    );
    return Promise.resolve([found, []]);
  }

  // Check banned users
  if (sqlStr.includes("SELECT ban_id FROM workspace_banned_users WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const found = mockBannedUsers.filter(
      (b) => b.workspace_id === Number(wId) && b.user_id === Number(uId)
    );
    return Promise.resolve([found, []]);
  }

  // Update member role
  if (sqlStr.includes("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?")) {
    const [role, wId, uId] = params;
    const member = mockWorkspaceMembers.find(
      (m) => m.workspace_id === Number(wId) && m.user_id === Number(uId)
    );
    if (member) member.role = role;
    return Promise.resolve([{ affectedRows: 1 }, []]);
  }

  // Delete from workspace_members (remove or ban)
  if (sqlStr.includes("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const prevLen = mockWorkspaceMembers.length;
    mockWorkspaceMembers = mockWorkspaceMembers.filter(
      (m) => !(m.workspace_id === Number(wId) && m.user_id === Number(uId))
    );
    return Promise.resolve([{ affectedRows: prevLen - mockWorkspaceMembers.length }, []]);
  }

  // Insert into workspace_banned_users
  if (sqlStr.includes("INSERT INTO workspace_banned_users")) {
    const [wId, uId, bannedBy, reason] = params;
    mockBannedUsers.push({
      ban_id: mockBannedUsers.length + 1,
      workspace_id: Number(wId),
      user_id: Number(uId),
      banned_by: Number(bannedBy),
      reason: reason || "Banned",
      created_at: new Date()
    });
    return Promise.resolve([{ insertId: mockBannedUsers.length }, []]);
  }

  // Unban user
  if (sqlStr.includes("DELETE FROM workspace_banned_users WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const prevLen = mockBannedUsers.length;
    mockBannedUsers = mockBannedUsers.filter(
      (b) => !(b.workspace_id === Number(wId) && b.user_id === Number(uId))
    );
    return Promise.resolve([{ affectedRows: prevLen - mockBannedUsers.length }, []]);
  }

  // Get banned users
  if (sqlStr.includes("FROM workspace_banned_users b")) {
    const [wId] = params;
    const list = mockBannedUsers.filter((b) => b.workspace_id === Number(wId)).map((b) => ({
      ...b,
      name: `User ${b.user_id}`,
      email: `user${b.user_id}@example.com`,
      banned_by_name: `User ${b.banned_by}`
    }));
    return Promise.resolve([list, []]);
  }

  // Check channel for deletion
  if (sqlStr.includes("SELECT workspace_id, name FROM channels WHERE channel_id = ?")) {
    const [cId] = params;
    const found = mockChannels.filter((c) => c.channel_id === Number(cId));
    return Promise.resolve([found, []]);
  }

  // Delete channel
  if (sqlStr.includes("DELETE FROM channels WHERE channel_id = ?")) {
    const [cId] = params;
    mockChannels = mockChannels.filter((c) => c.channel_id !== Number(cId));
    return Promise.resolve([{ affectedRows: 1 }, []]);
  }

  return Promise.resolve([[], []]);
});

const mockConnection = {
  query: mockQuery,
  beginTransaction: jest.fn().mockResolvedValue(),
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
};

jest.mock("../config/db", () => ({
  promise: () => mockConnection,
}));

const workspaceRoutes = require("../routes/workspaceRoutes");
const channelRoutes = require("../routes/channelRoutes");

const app = express();
app.use(express.json());
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/channels", channelRoutes);

const makeToken = (user_id, email = "user@test.com") => {
  return jwt.sign({ user_id, email }, process.env.JWT_SECRET, { expiresIn: "1h" });
};

describe("Role Management & Permissions Hierarchy API", () => {
  beforeEach(() => {
    mockWorkspaceMembers = [
      { workspace_id: 1, user_id: 1, role: "owner" },
      { workspace_id: 1, user_id: 2, role: "admin" },
      { workspace_id: 1, user_id: 3, role: "member" },
    ];
    mockBannedUsers = [];
    mockChannels = [{ channel_id: 1, workspace_id: 1, name: "general" }];
    jest.clearAllMocks();
  });

  describe("Role Promotion / Demotion (Owner only)", () => {
    it("allows Owner to promote Member to Admin", async () => {
      const token = makeToken(1); // Owner
      const res = await request(app)
        .put("/api/workspaces/1/members/3/role")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role).toBe("admin");
    });

    it("allows Owner to demote Admin to Member", async () => {
      const token = makeToken(1); // Owner
      const res = await request(app)
        .put("/api/workspaces/1/members/2/role")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "member" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role).toBe("member");
    });

    it("forbids Admin from changing roles", async () => {
      const token = makeToken(2); // Admin
      const res = await request(app)
        .put("/api/workspaces/1/members/3/role")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("prevents changing the Owner's role", async () => {
      const token = makeToken(1); // Owner targeting self
      const res = await request(app)
        .put("/api/workspaces/1/members/1/role")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "member" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Remove Member Permissions", () => {
    it("allows Owner to remove an Admin", async () => {
      const token = makeToken(1); // Owner
      const res = await request(app)
        .delete("/api/workspaces/1/members/2")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("allows Admin to remove a Member", async () => {
      const token = makeToken(2); // Admin
      const res = await request(app)
        .delete("/api/workspaces/1/members/3")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("forbids Admin from removing the Owner", async () => {
      const token = makeToken(2); // Admin
      const res = await request(app)
        .delete("/api/workspaces/1/members/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("forbids Admin from removing another Admin", async () => {
      mockWorkspaceMembers.push({ workspace_id: 1, user_id: 4, role: "admin" });
      const token = makeToken(2); // Admin 2
      const res = await request(app)
        .delete("/api/workspaces/1/members/4")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("forbids Member from removing anyone", async () => {
      const token = makeToken(3); // Member
      const res = await request(app)
        .delete("/api/workspaces/1/members/2")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Ban & Unban System", () => {
    it("allows Owner to ban Member", async () => {
      const token = makeToken(1);
      const res = await request(app)
        .post("/api/workspaces/1/members/3/ban")
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Violation of rules" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockBannedUsers.length).toBe(1);
      expect(mockBannedUsers[0].user_id).toBe(3);
    });

    it("allows Admin to ban Member", async () => {
      const token = makeToken(2);
      const res = await request(app)
        .post("/api/workspaces/1/members/3/ban")
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Spamming" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("forbids Admin from banning Owner", async () => {
      const token = makeToken(2);
      const res = await request(app)
        .post("/api/workspaces/1/members/1/ban")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("forbids Admin from banning another Admin", async () => {
      mockWorkspaceMembers.push({ workspace_id: 1, user_id: 4, role: "admin" });
      const token = makeToken(2);
      const res = await request(app)
        .post("/api/workspaces/1/members/4/ban")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("allows Owner/Admin to unban user", async () => {
      mockBannedUsers.push({ ban_id: 1, workspace_id: 1, user_id: 3, banned_by: 1 });
      const token = makeToken(1);
      const res = await request(app)
        .post("/api/workspaces/1/banned/3/unban")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockBannedUsers.length).toBe(0);
    });

    it("allows Owner/Admin to list banned members", async () => {
      mockBannedUsers.push({ ban_id: 1, workspace_id: 1, user_id: 3, banned_by: 1, reason: "Rule breach" });
      const token = makeToken(1);
      const res = await request(app)
        .get("/api/workspaces/1/banned")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.banned_members.length).toBe(1);
    });
  });

  describe("Channel Deletion", () => {
    it("allows Owner to delete channel", async () => {
      const token = makeToken(1);
      const res = await request(app)
        .delete("/api/channels/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("allows Admin to delete channel", async () => {
      const token = makeToken(2);
      const res = await request(app)
        .delete("/api/channels/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("forbids Member from deleting channel", async () => {
      const token = makeToken(3);
      const res = await request(app)
        .delete("/api/channels/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });
});

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = "test";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

let mockUsers = [
  {
    user_id: 1,
    name: "Alice Smith",
    email: "alice@example.com",
    password_hash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456", // dummy hash
    avatar_url: null,
    created_at: new Date(),
  },
];

const mockQuery = jest.fn().mockImplementation((sql, params) => {
  const sqlStr = typeof sql === "string" ? sql : "";

  // Get user profile
  if (sqlStr.includes("SELECT user_id, name, email, avatar_url, created_at FROM users WHERE user_id = ?") ||
      sqlStr.includes("SELECT user_id, email, avatar_url FROM users WHERE user_id = ?") ||
      sqlStr.includes("SELECT * FROM users WHERE user_id = ?")) {
    const [uId] = params;
    const found = mockUsers.filter((u) => u.user_id === Number(uId));
    return Promise.resolve([found, []]);
  }

  // Update profile (name, avatar_url)
  if (sqlStr.includes("UPDATE users SET name = ?, avatar_url = ? WHERE user_id = ?")) {
    const [name, avatar, uId] = params;
    const user = mockUsers.find((u) => u.user_id === Number(uId));
    if (user) {
      user.name = name;
      user.avatar_url = avatar;
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  }

  // Update password
  if (sqlStr.includes("UPDATE users SET password_hash = ? WHERE user_id = ?")) {
    const [hash, uId] = params;
    const user = mockUsers.find((u) => u.user_id === Number(uId));
    if (user) {
      user.password_hash = hash;
    }
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

const userRoutes = require("../routes/userRoutes");

const app = express();
app.use(express.json());
app.use("/api/users", userRoutes);

const makeToken = (user_id, email = "alice@example.com") => {
  return jwt.sign({ user_id, email }, process.env.JWT_SECRET, { expiresIn: "1h" });
};

describe("User Profile & DP Management API", () => {
  beforeEach(async () => {
    const hashedPassword = await bcrypt.hash("oldpassword123", 10);
    mockUsers = [
      {
        user_id: 1,
        name: "Alice Smith",
        email: "alice@example.com",
        password_hash: hashedPassword,
        avatar_url: null,
        created_at: new Date(),
      },
    ];
    jest.clearAllMocks();
  });

  it("gets current user profile", async () => {
    const token = makeToken(1);
    const res = await request(app)
      .get("/api/users/profile")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.name).toBe("Alice Smith");
  });

  it("updates user profile name and avatar_url", async () => {
    const token = makeToken(1);
    const res = await request(app)
      .put("/api/users/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Alice Cooper",
        avatar_url: "https://example.com/avatar.png",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.name).toBe("Alice Cooper");
    expect(res.body.user.avatar_url).toBe("https://example.com/avatar.png");
  });

  it("changes password successfully when current password is valid", async () => {
    const token = makeToken(1);
    const res = await request(app)
      .put("/api/users/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: "oldpassword123",
        newPassword: "newsecurepassword456",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects password change if current password is wrong", async () => {
    const token = makeToken(1);
    const res = await request(app)
      .put("/api/users/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: "wrongpassword",
        newPassword: "newsecurepassword456",
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

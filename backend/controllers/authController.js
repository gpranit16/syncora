const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(name).trim();

    const [existingUsers] = await db
      .promise()
      .query("SELECT user_id FROM users WHERE LOWER(TRIM(email)) = ?", [cleanEmail]);

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db
      .promise()
      .query("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [
        cleanName,
        cleanEmail,
        hashedPassword,
      ]);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        user_id: result.insertId,
        name: cleanName,
        email: cleanEmail,
      },
    });
  } catch (error) {
    console.error("Register error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while registering user",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const [users] = await db
      .promise()
      .query("SELECT * FROM users WHERE LOWER(TRIM(email)) = ?", [cleanEmail]);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = users[0];
    const passwordHash = user.password_hash || user.password;

    if (!passwordHash) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    let isPasswordCorrect = false;
    try {
      isPasswordCorrect = await bcrypt.compare(password, passwordHash);
    } catch (bcryptErr) {
      console.error("Bcrypt compare error:", bcryptErr);
    }

    // Fallback if password was stored in plaintext
    if (!isPasswordCorrect && password === passwordHash) {
      isPasswordCorrect = true;
      const newHashed = await bcrypt.hash(password, 10);
      try {
        await db.promise().query("UPDATE users SET password_hash = ? WHERE user_id = ?", [newHashed, user.user_id]);
      } catch (e) {}
    }

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url || null,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while logging in",
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
};

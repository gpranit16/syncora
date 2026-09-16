const bcrypt = require("bcrypt");
const db = require("../config/db");

const getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [users] = await db.promise().query(
      "SELECT user_id, name, email, avatar_url, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user: users[0],
    });
  } catch (error) {
    console.error("Get profile error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching profile",
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { name, avatar_url } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    const [users] = await db.promise().query(
      "SELECT user_id, email, avatar_url FROM users WHERE user_id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const finalAvatar = avatar_url !== undefined ? avatar_url : users[0].avatar_url;

    await db.promise().query(
      "UPDATE users SET name = ?, avatar_url = ? WHERE user_id = ?",
      [name.trim(), finalAvatar, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: {
        user_id: userId,
        name: name.trim(),
        email: users[0].email,
        avatar_url: finalAvatar,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while updating profile",
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long",
      });
    }

    const [users] = await db.promise().query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = users[0];
    const passwordHash = user.password_hash || user.password;

    const isMatch = await bcrypt.compare(currentPassword, passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const newHashed = await bcrypt.hash(newPassword, 10);

    // Try updating password_hash and password
    try {
      await db.promise().query(
        "UPDATE users SET password_hash = ? WHERE user_id = ?",
        [newHashed, userId]
      );
    } catch (e) {
      await db.promise().query(
        "UPDATE users SET password = ? WHERE user_id = ?",
        [newHashed, userId]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while changing password",
    });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.user_id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No avatar image uploaded",
      });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;

    await db.promise().query(
      "UPDATE users SET avatar_url = ? WHERE user_id = ?",
      [avatarUrl, userId]
    );

    const [users] = await db.promise().query(
      "SELECT user_id, name, email, avatar_url FROM users WHERE user_id = ?",
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: "Avatar uploaded successfully",
      avatar_url: avatarUrl,
      user: users[0],
    });
  } catch (error) {
    console.error("Upload avatar error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while uploading avatar",
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
};

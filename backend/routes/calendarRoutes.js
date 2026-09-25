const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  getConnectUrl,
  oauthCallback,
  getStatus,
  updateSettings,
  disconnect,
} = require("../controllers/calendarController");

// Public callback hit directly by Google OAuth redirect
router.get("/callback", oauthCallback);

// Authenticated endpoints for frontend
router.get("/auth-url", authMiddleware, getConnectUrl);
router.get("/connect", authMiddleware, getConnectUrl);
router.get("/status", authMiddleware, getStatus);
router.put("/settings", authMiddleware, updateSettings);
router.post("/disconnect", authMiddleware, disconnect);

module.exports = router;

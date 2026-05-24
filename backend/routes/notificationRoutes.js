const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createNotification,
  getUserNotifications,
  markNotificationAsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.post("/create", authMiddleware, createNotification);
router.get("/my-notifications", authMiddleware, getUserNotifications);
router.put("/read/:notificationId", authMiddleware, markNotificationAsRead);

module.exports = router;

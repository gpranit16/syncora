const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendMessage,
  getChannelMessages,
  editMessage,
  deleteMessage,
} = require("../controllers/messageController");

const router = express.Router();

router.post("/send", authMiddleware, sendMessage);
router.get("/channel/:channelId", authMiddleware, getChannelMessages);
router.put("/edit/:messageId", authMiddleware, editMessage);
router.delete("/:messageId", authMiddleware, deleteMessage);

module.exports = router;

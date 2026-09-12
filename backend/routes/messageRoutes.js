const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendMessage,
  getChannelMessages,
  editMessage,
  deleteMessage,
} = require("../controllers/messageController");
const { channelReactions } = require("../controllers/reactionController");
const { channelPins } = require("../controllers/pinController");

const router = express.Router();

router.post("/send", authMiddleware, sendMessage);
router.get("/channel/:channelId", authMiddleware, getChannelMessages);
router.put("/edit/:messageId", authMiddleware, editMessage);
router.put("/:messageId/reactions", authMiddleware, channelReactions.toggleReaction);
router.delete("/:messageId/reactions", authMiddleware, channelReactions.removeReaction);
router.put("/:messageId/pin", authMiddleware, channelPins.togglePin);
router.delete("/:messageId", authMiddleware, deleteMessage);

module.exports = router;

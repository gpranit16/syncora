const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendDirectMessage,
  getDirectMessages,
  getRecentDmUsers,
  editDirectMessage,
  deleteDirectMessage,
} = require("../controllers/directMessageController");
const { dmReactions } = require("../controllers/reactionController");
const { dmPins } = require("../controllers/pinController");

const router = express.Router();

router.post("/send", authMiddleware, sendDirectMessage);
router.get("/recent", authMiddleware, getRecentDmUsers);
router.get("/chat/:receiverId", authMiddleware, getDirectMessages);
router.put("/:messageId", authMiddleware, editDirectMessage);
router.put("/:messageId/reactions", authMiddleware, dmReactions.toggleReaction);
router.delete("/:messageId/reactions", authMiddleware, dmReactions.removeReaction);
router.put("/:messageId/pin", authMiddleware, dmPins.togglePin);
router.delete("/:messageId", authMiddleware, deleteDirectMessage);

module.exports = router;

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendDirectMessage,
  getDirectMessages,
  getRecentDmUsers,
  editDirectMessage,
  deleteDirectMessage,
} = require("../controllers/directMessageController");

const router = express.Router();

router.post("/send", authMiddleware, sendDirectMessage);
router.get("/chat/:receiverId", authMiddleware, getDirectMessages);
router.get("/recent", authMiddleware, getRecentDmUsers);
router.put("/:messageId", authMiddleware, editDirectMessage);
router.delete("/:messageId", authMiddleware, deleteDirectMessage);

module.exports = router;

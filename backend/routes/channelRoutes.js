const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const {
  createChannel,
  getWorkspaceChannels,
  deleteChannel,
} = require("../controllers/channelController");

const router = express.Router();

router.post("/create", authMiddleware, allowRoles("owner", "admin"), createChannel);
router.get("/workspace/:workspaceId", authMiddleware, getWorkspaceChannels);
router.delete("/:channelId", authMiddleware, deleteChannel);

module.exports = router;

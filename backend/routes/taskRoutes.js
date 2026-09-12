const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const {
  createTask,
  createTaskFromMessage,
  updateTask,
  getWorkspaceTasks,
  updateTaskStatus,
} = require("../controllers/taskController");

const router = express.Router();

// Create task (owner/admin only)
router.post("/create", authMiddleware, allowRoles("owner", "admin"), createTask);
// Create task from a message (any workspace member can do this)
router.post("/create-from-message", authMiddleware, createTaskFromMessage);
// Update task fields (any workspace member)
router.put("/update/:taskId", authMiddleware, updateTask);
// Get tasks for a workspace
router.get("/workspace/:workspaceId", authMiddleware, getWorkspaceTasks);
// Update task status
router.put("/status/:taskId", authMiddleware, updateTaskStatus);

module.exports = router;

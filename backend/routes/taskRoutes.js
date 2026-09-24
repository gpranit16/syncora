const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createTask,
  createTaskFromMessage,
  updateTask,
  deleteTask,
  getWorkspaceTasks,
  updateTaskStatus,
} = require("../controllers/taskController");

const router = express.Router();

// Create task (any workspace member can create and assign tasks)
router.post("/create", authMiddleware, createTask);
// Create task from a message (any workspace member can do this)
router.post("/create-from-message", authMiddleware, createTaskFromMessage);
// Update task fields (any workspace member)
router.put("/update/:taskId", authMiddleware, updateTask);
// Delete task
router.delete("/:taskId", authMiddleware, deleteTask);
// Get tasks for a workspace (supports ?scope=assigned_to_me, ?assigned_to=..., ?status=...)
router.get("/workspace/:workspaceId", authMiddleware, getWorkspaceTasks);
// Update task status
router.put("/status/:taskId", authMiddleware, updateTaskStatus);

module.exports = router;

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const {
  createTask,
  getWorkspaceTasks,
  updateTaskStatus,
} = require("../controllers/taskController");

const router = express.Router();

router.post("/create", authMiddleware, allowRoles("owner", "admin"), createTask);
router.get("/workspace/:workspaceId", authMiddleware, getWorkspaceTasks);
router.put("/status/:taskId", authMiddleware, updateTaskStatus);

module.exports = router;

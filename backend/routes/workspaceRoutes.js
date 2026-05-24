const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createWorkspace,
  getUserWorkspaces,
  addMemberByEmail,
  getAvailableWorkspaces,
  joinWorkspace,
  getWorkspaceMembers
} = require("../controllers/workspaceController");

const router = express.Router();

router.post("/create", authMiddleware, createWorkspace);
router.get("/my-workspaces", authMiddleware, getUserWorkspaces);
router.post("/add-member", authMiddleware, addMemberByEmail);
router.get("/available", authMiddleware, getAvailableWorkspaces);
router.post("/join", authMiddleware, joinWorkspace);
router.get("/:workspaceId/members", authMiddleware, getWorkspaceMembers);

module.exports = router;

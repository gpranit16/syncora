const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createWorkspace,
  getUserWorkspaces,
  addMemberByEmail,
  getAvailableWorkspaces,
  joinWorkspace,
  getWorkspaceMembers,
  updateMemberRole,
  removeMember,
  banMember,
  unbanMember,
  getBannedMembers,
} = require("../controllers/workspaceController");

const router = express.Router();

router.post("/create", authMiddleware, createWorkspace);
router.get("/my-workspaces", authMiddleware, getUserWorkspaces);
router.post("/add-member", authMiddleware, addMemberByEmail);
router.get("/available", authMiddleware, getAvailableWorkspaces);
router.post("/join", authMiddleware, joinWorkspace);
router.get("/:workspaceId/members", authMiddleware, getWorkspaceMembers);

// Role & Member Management Routes
router.put("/:workspaceId/members/:userId/role", authMiddleware, updateMemberRole);
router.delete("/:workspaceId/members/:userId", authMiddleware, removeMember);
router.post("/:workspaceId/members/:userId/ban", authMiddleware, banMember);
router.post("/:workspaceId/banned/:userId/unban", authMiddleware, unbanMember);
router.get("/:workspaceId/banned", authMiddleware, getBannedMembers);

module.exports = router;

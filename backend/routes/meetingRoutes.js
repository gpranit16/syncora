const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  createMeeting,
  getActiveMeetingByChannel,
  getMeetingByCode,
  endMeeting,
  inviteToMeeting,
  checkDeepgramDiagnostic,
} = require("../controllers/meetingController");
const {
  saveTranscript,
  getTranscript,
  generateSummary,
  getSummary,
  createTaskFromActionItem,
} = require("../controllers/meetingAIController");

router.post("/", authMiddleware, createMeeting);
router.post("/create", authMiddleware, createMeeting);
router.get("/channel/:channelId/active", authMiddleware, getActiveMeetingByChannel);
router.get("/code/:meetingCode", authMiddleware, getMeetingByCode);
router.post("/:meetingId/end", authMiddleware, endMeeting);
router.post("/code/:meetingCode/end", authMiddleware, endMeeting);
router.post("/:meetingId/invite", authMiddleware, inviteToMeeting);
router.get("/diagnostic/deepgram", checkDeepgramDiagnostic);

// Meeting AI routes
router.post("/:meetingCode/transcript", authMiddleware, saveTranscript);
router.get("/:meetingCode/transcript", authMiddleware, getTranscript);
router.post("/:meetingCode/summary", authMiddleware, generateSummary);
router.get("/:meetingCode/summary", authMiddleware, getSummary);
router.post("/:meetingCode/action-items/convert-task", authMiddleware, createTaskFromActionItem);

module.exports = router;


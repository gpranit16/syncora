const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getUnreadCounts } = require("../controllers/unreadController");

const router = express.Router();

router.get("/count", authMiddleware, getUnreadCounts);

module.exports = router;
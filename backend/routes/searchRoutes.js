const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { globalSearch } = require("../controllers/searchController");

const router = express.Router();

router.get("/", authMiddleware, globalSearch);

module.exports = router;

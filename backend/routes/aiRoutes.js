const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { askAI, askTaskAI } = require('../controllers/aiController');

const router = express.Router();

router.post('/ask', authMiddleware, askAI);
router.post('/ask-tasks', authMiddleware, askTaskAI);

module.exports = router;
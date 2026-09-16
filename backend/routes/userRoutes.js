const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
} = require("../controllers/userController");

const router = express.Router();

router.get("/profile", authMiddleware, getProfile);
router.put("/profile", authMiddleware, updateProfile);
router.put("/change-password", authMiddleware, changePassword);
router.post("/avatar", authMiddleware, upload.single("avatar"), uploadAvatar);

module.exports = router;

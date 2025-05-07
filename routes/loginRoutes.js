
const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");
const { registerUser, loginUser } = require("../controllers/loginController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/login", loginUser);

router.post(
  "/register",
  authMiddleware,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "licenseNoImage", maxCount: 1 },
    { name: "adharNoImage", maxCount: 1 },
  ]),
  registerUser
);

module.exports = router;

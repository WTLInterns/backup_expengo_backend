
const express = require("express");
const router = express.Router();

const {
    getAllDrivers,
    updateDriverProfile,
    deleteDriverProfile,
    forgotPassword,
    resetPassword
} = require("../controllers/driverProfileController");

const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");

//  Protected Routes
// router.use("/profile", authMiddleware);

//  Get all drivers (admin only)
router.get("/profile", isAdmin, getAllDrivers);

//  Update driver profile (accessible by owner or super-admin)
router.put("/profile/:id", updateDriverProfile);

//  Delete driver profile
router.delete("/profile/:id", deleteDriverProfile);

// 🔓 Public Routes
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;


const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadFields");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const { driverAuthMiddleware } = require("../middleware/driverAuthMiddleware");
const { addCab, driverAdd, getCab, driverCab, getById, deleteCab } = require("../controllers/cabsDetailsController");


router.patch('/add', authMiddleware, isAdmin, upload, addCab);


router.patch('/driver/add', driverAuthMiddleware, upload, driverAdd);


// ✅ 2️⃣ Get All Cabs
router.get("/", authMiddleware, isAdmin, getCab);

router.get("/driver", driverAuthMiddleware, driverCab);

// ✅ 3️⃣ Get a Single Cab by ID
router.get("/:id", authMiddleware, isAdmin, getById);


router.delete("/delete/:id", authMiddleware, isAdmin, deleteCab);

module.exports = router;



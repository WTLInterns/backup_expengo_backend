const Driver = require("../models/loginModel");
const cloudinary = require("../config/cloudinary");
const redisClient = require("../config/redisClient");

// Get All Drivers (with caching)
const getAllDrivers = async (req, res) => {
  const cacheKey = `drivers:${req.admin._id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }

    const drivers = await Driver.find({ addedBy: req.admin._id }).select("-password -__v");
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(drivers)); // cache for 1 hour

    res.status(200).json(drivers);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Update Driver Profile (with cache invalidation)
const updateDriverProfile = async (req, res) => {
  try {
    const { id: adminId, role: adminRole } = req.admin;
    const { id: driverId } = req.params;

    const driver = await Driver.findById(driverId).select("addedBy");
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    if (driver.addedBy.toString() !== adminId && adminRole !== "super-admin") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(driverId, req.body, {
      new: true,
      runValidators: true
    }).select("-password -__v");

    await redisClient.del(`drivers:${driver.addedBy}`);

    res.json({ message: "Driver profile updated successfully", updatedDriver });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

// Delete Driver Profile (with cache invalidation)
const deleteDriverProfile = async (req, res) => {
  try {
    const { id: adminId, role: adminRole } = req.admin;
    const { id: driverId } = req.params;

    const driver = await Driver.findById(driverId).select("addedBy imageId");
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    if (driver.addedBy.toString() !== adminId && adminRole !== "super-admin") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (driver.imageId) {
      await cloudinary.uploader.destroy(driver.imageId);
    }

    await Driver.findByIdAndDelete(driverId);
    await redisClient.del(`drivers:${driver.addedBy}`);

    res.json({ message: "Driver and image deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

// Forgot Password (with rate limiting using Redis)
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ message: "Email is required" });

    const rateKey = `fp-rate:${email}`;
    const attempts = await redisClient.incr(rateKey);
    if (attempts === 1) await redisClient.expire(rateKey, 60); // 60s window
    if (attempts > 3) {
      return res.status(429).json({ message: "Too many requests. Try again later." });
    }

    const driver = await Driver.findOne({ email }).select("_id");
    if (!driver) return res.status(404).json({ message: "Driver with this email does not exist" });

    res.status(200).json({ message: "Driver verified", driverId: driver._id });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { driverId, newPassword } = req.body;

    if (!driverId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const driver = await Driver.findById(driverId).select("password");
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    driver.password = newPassword;
    await driver.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

module.exports = {
  getAllDrivers,
  updateDriverProfile,
  deleteDriverProfile,
  forgotPassword,
  resetPassword
};

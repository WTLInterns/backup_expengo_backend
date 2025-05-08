
const CabAssignment = require('../models/CabAssignment');
const Driver = require('../models/loginModel');
const Cab = require('../models/CabsDetails');
const mongoose = require('mongoose');
const redisClient = require("../config/redisClient");

const assignTripToDriver = async (req, res) => {
  try {
    const { driverId, cabNumber, assignedBy } = req.body;

    if (!driverId || !cabNumber || !assignedBy) {
      return res.status(400).json({ message: "Driver ID, Cab Number, and Assigned By are required" });
    }

    // Check Redis cache first
    const redisKey = `cab:${cabNumber}`;
    let cabData = await redisClient.get(redisKey);
    let cab;

    if (cabData) {
      cab = JSON.parse(cabData);
      console.log("📦 Cab fetched from Redis cache");
    } else {
      cab = mongoose.Types.ObjectId.isValid(cabNumber)
        ? await Cab.findById(cabNumber)
        : await Cab.findOne({ cabNumber });

      if (!cab) return res.status(404).json({ message: "Cab not found" });

      // Cache the cab data in Redis for future lookups
      await redisClient.set(redisKey, JSON.stringify(cab), { EX: 3600 }); // 1 hour expiration
      console.log("📌 Cab cached in Redis");
    }

    const existingAssignment = await CabAssignment.findOne({
      $or: [
        { driver: driverId, status: { $ne: "completed" } },
        { cab: cab._id, status: { $ne: "completed" } }
      ]
    });

    if (existingAssignment) {
      return res.status(400).json({ message: "Driver or cab already has an active trip" });
    }

    const assignment = new CabAssignment({
      driver: driverId,
      cab: cab._id,
      assignedBy,
      status: "assigned",
    });

    await assignment.save();
    res.status(201).json({ message: "✅ Trip assigned to driver", assignment });

  } catch (error) {
    console.error("❌ Error assigning trip:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateTripDetailsByDriver = async (req, res) => {
  try {
    const driverId = req.driver.id;

    const assignment = await CabAssignment.findOne({
      driver: driverId,
      status: { $ne: "completed" },
    });

    if (!assignment) {
      return res.status(404).json({ message: "No active trip found for this driver." });
    }

    const files = req.files || {};
    const body = req.body;

    const sanitizeKeys = (obj) => {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key.trim()] = obj[key];
      }
      return sanitized;
    };

    const sanitizedBody = sanitizeKeys(body);

    const parseJSONSafely = (data, fallback = {}) => {
      try {
        return typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        return fallback;
      }
    };

    const extractImageArray = (fieldName) =>
      Array.isArray(files[fieldName]) ? files[fieldName].map((f) => f.path) : [];

    const appendArray = (existing = [], incoming) => {
      if (!incoming) return existing;
      return Array.isArray(incoming) ? [...existing, ...incoming] : [...existing, incoming];
    };

    const calculateKmTravelled = (meterReadings) => {
      let totalMeters = 0;
      for (let i = 1; i < meterReadings.length; i++) {
        const diff = meterReadings[i] - meterReadings[i - 1];
        if (diff > 0) {
          totalMeters += diff;
        }
      }
      return Math.round(totalMeters); // in KM
    };

    if (!assignment.tripDetails) {
      assignment.tripDetails = {};
    }

    const trip = assignment.tripDetails;

    if (sanitizedBody.location) {
      const parsedLocation = parseJSONSafely(sanitizedBody.location);
      trip.location = { ...trip.location, ...parsedLocation };
    }

    if (sanitizedBody.fuel) {
      const fuel = parseJSONSafely(sanitizedBody.fuel);
      trip.fuel = {
        ...trip.fuel,
        ...fuel,
        amount: appendArray(trip?.fuel?.amount, fuel.amount),
        receiptImage: appendArray(trip?.fuel?.receiptImage, extractImageArray("receiptImage")),
        transactionImage: appendArray(trip?.fuel?.transactionImage, extractImageArray("transactionImage")),
      };
    }

    if (sanitizedBody.fastTag) {
      const tag = parseJSONSafely(sanitizedBody.fastTag);
      trip.fastTag = {
        ...trip.fastTag,
        ...tag,
        amount: appendArray(trip?.fastTag?.amount, tag.amount),
      };
    }

    if (sanitizedBody.tyrePuncture) {
      const tyre = parseJSONSafely(sanitizedBody.tyrePuncture);
      trip.tyrePuncture = {
        ...trip.tyrePuncture,
        ...tyre,
        repairAmount: appendArray(trip?.tyrePuncture?.repairAmount, tyre.repairAmount),
        image: appendArray(trip?.tyrePuncture?.image, extractImageArray("punctureImage")),
      };
    }

    if (sanitizedBody.vehicleServicing) {
      const service = parseJSONSafely(sanitizedBody.vehicleServicing);

      const existingMeter = Array.isArray(trip.vehicleServicing?.meter) ? trip.vehicleServicing.meter : [];
      let newMeterArray = [...existingMeter];

      const newMeter = Number(service?.meter);
      if (!isNaN(newMeter)) {
        newMeterArray.push(newMeter);
      }

      const kmTravelled = calculateKmTravelled(newMeterArray);

      trip.vehicleServicing = {
        ...trip.vehicleServicing,
        ...service,
        amount: appendArray(trip?.vehicleServicing?.amount, service.amount),
        meter: newMeterArray,
        kmTravelled,
        image: appendArray(trip?.vehicleServicing?.image, extractImageArray("vehicleServicingImage")),
        receiptImage: appendArray(trip?.vehicleServicing?.receiptImage, extractImageArray("vehicleServicingReceiptImage")),
      };
    }

    if (sanitizedBody.otherProblems) {
      const other = parseJSONSafely(sanitizedBody.otherProblems);
      trip.otherProblems = {
        ...trip.otherProblems,
        ...other,
        amount: appendArray(trip?.otherProblems?.amount, other.amount),
        image: appendArray(trip?.otherProblems?.image, extractImageArray("otherProblemsImage")),
      };
    }

    assignment.tripDetails = trip;
    await assignment.save();

    // 🧹 Invalidate Redis cache for this cab (if used elsewhere like in assignTripToDriver)
    if (assignment.cab) {
      const redisKey = `cab:${assignment.cab}`;
      await redisClient.del(redisKey);
      console.log(`🗑️ Redis cache invalidated for cab: ${assignment.cab}`);
    }

    res.status(200).json({
      message: "✅ Trip details updated successfully",
      assignment,
    });

  } catch (err) {
    console.error("❌ Trip update error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// ✅ Get all active cabs assigned by the logged-in admin
const getAssignCab = async (req, res) => {
  try {
    const adminId = req.admin._id.toString();
    const redisKey = `assignedCabs:${adminId}`;

    // 🧠 Check cache first
    const cachedData = await redisClient.get(redisKey);
    if (cachedData) {
      console.log("📦 Served from Redis cache");
      return res.status(200).json(JSON.parse(cachedData));
    }

    // 🔍 Fetch from DB
    const assignments = await CabAssignment.find()
      .populate("cab")
      .populate("driver");

    const filteredAssignments = assignments.filter(
      (a) => a.cab && a.assignedBy.toString() === adminId
    );

    // 💾 Save to Redis
    await redisClient.set(redisKey, JSON.stringify(filteredAssignments), {
      EX: 300, // expires in 5 minutes
    });

    console.log("💾 Data cached in Redis");
    res.status(200).json(filteredAssignments);
  } catch (error) {
    console.error("❌ Redis/GetAssignCab Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// ✅ Assign a cab to a driver
const assignCab = async (req, res) => {
  try {
    const { driverId, cabNumber, assignedBy } = req.body;

    if (!driverId || !cabNumber || !assignedBy) {
      return res.status(400).json({ message: 'Driver ID, Cab Number, and Assigned By are required' });
    }

    const cab = mongoose.Types.ObjectId.isValid(cabNumber)
      ? await Cab.findById(cabNumber)
      : await Cab.findOne({ cabNumber });

    if (!cab) return res.status(404).json({ message: 'Cab not found' });

    const existingDriverAssignment = await CabAssignment.findOne({
      driver: driverId,
      status: { $ne: "completed" }
    });
    if (existingDriverAssignment)
      return res.status(400).json({ message: 'This driver already has an active cab assigned' });

    const existingCabAssignment = await CabAssignment.findOne({
      cab: cab._id,
      status: { $ne: "completed" }
    });
    if (existingCabAssignment)
      return res.status(400).json({ message: 'This cab is already assigned to another driver' });

    const newAssignment = new CabAssignment({
      driver: driverId,
      cab: cab._id,
      assignedBy,
      status: "assigned" // optional: define explicitly
    });

    await newAssignment.save();

    // 🧹 Invalidate cache for the admin
    const redisKey = `assignedCabs:${assignedBy}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for key: ${redisKey}`);

    res.status(201).json({ message: 'Cab assigned successfully', assignment: newAssignment });
  } catch (error) {
    console.error("❌ assignCab Error:", error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ✅ Assign a cab to a driver (called by driver)
const driverAssignCab = async (req, res) => {
  try {
    const { cabNumber, assignedBy } = req.body;
    const driverId = req.driver.id;

    if (!driverId || !cabNumber || !assignedBy) {
      return res.status(400).json({ message: 'Driver ID, Cab Number, and Assigned By are required' });
    }

    const cab = mongoose.Types.ObjectId.isValid(cabNumber)
      ? await Cab.findById(cabNumber)
      : await Cab.findOne({ cabNumber });

    if (!cab) return res.status(404).json({ message: 'Cab not found' });

    const existingDriverAssignment = await CabAssignment.findOne({
      driver: driverId,
      status: { $ne: "completed" }
    });
    if (existingDriverAssignment)
      return res.status(400).json({ message: 'This driver already has an active cab assigned' });

    const existingCabAssignment = await CabAssignment.findOne({
      cab: cab._id,
      status: { $ne: "completed" }
    });
    if (existingCabAssignment)
      return res.status(400).json({ message: 'This cab is already assigned to another driver' });

    const newAssignment = new CabAssignment({
      driver: driverId,
      cab: cab._id,
      assignedBy,
      status: "assigned" // ensure consistent status
    });

    await newAssignment.save();

    // 🧹 Invalidate Redis cache for admin's cab assignments
    const redisKey = `assignedCabs:${assignedBy}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for key: ${redisKey}`);

    res.status(201).json({ message: 'Cab assigned successfully', assignment: newAssignment });
  } catch (error) {
    console.error("❌ driverAssignCab Error:", error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const completeTrip = async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const assignment = await CabAssignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    assignment.status = "completed";
    await assignment.save();

    // 🧹 Invalidate Redis cache for admin who assigned this trip
    const redisKey = `assignedCabs:${assignment.assignedBy}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for key: ${redisKey}`);

    res.json({ message: "Trip marked as completed", assignment });
  } catch (err) {
    console.error("❌ Error completing trip:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

const unassignCab = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const adminRole = req.admin.role;

    const cabAssignment = await CabAssignment.findById(req.params.id);
    if (!cabAssignment) {
      return res.status(404).json({ message: "Cab assignment not found" });
    }

    if (cabAssignment.assignedBy.toString() !== adminId && adminRole !== "super-admin") {
      return res.status(403).json({ message: "Unauthorized: You can only unassign cabs assigned by you" });
    }

    await CabAssignment.findByIdAndDelete(req.params.id);

    // 🧹 Invalidate Redis cache for admin who unassigned
    const redisKey = `assignedCabs:${cabAssignment.assignedBy}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for key: ${redisKey}`);

    res.status(200).json({ message: "Cab unassigned successfully" });
  } catch (error) {
    console.error("❌ Error unassigning cab:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

const getAssignDriver = async (req, res) => {
  try {
    const driverId = req.driver.id;

    // Check Redis cache first
    const cacheKey = `driverAssignments:${driverId}`;
    const cachedAssignments = await redisClient.get(cacheKey);

    if (cachedAssignments) {
      console.log("🔄 Cache hit: Returning cached driver assignments");
      return res.status(200).json(JSON.parse(cachedAssignments));
    }

    // If cache miss, fetch from DB
    const assignments = await CabAssignment.find({ driver: driverId, status: { $ne: "completed" } })
      .populate("cab")
      .populate("driver");

    if (!assignments.length) {
      return res.status(404).json({ message: "No active cab assignments found for this driver." });
    }

    // Cache the result for future use
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(assignments)); // Cache for 1 hour
    console.log("🔄 Cache miss: Storing driver assignments in cache");

    res.status(200).json(assignments);
  } catch (error) {
    console.error("❌ Error getting driver assignments:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};
const EditDriverProfile = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const updatedDriver = await Driver.findByIdAndUpdate(driverId, req.body, {
      new: true,
      runValidators: true
    }).select("-password");

    if (!updatedDriver) return res.status(404).json({ message: "Driver not found" });

    // 🧹 Invalidate Redis cache for the driver profile
    const redisKey = `driverProfile:${driverId}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for key: ${redisKey}`);

    res.json({ message: "Profile updated successfully", updatedDriver });
  } catch (err) {
    console.error("❌ Error editing driver profile:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
module.exports = {
  assignCab,
  getAssignCab,
  unassignCab,
  EditDriverProfile,
  getAssignDriver,
  completeTrip,
  assignTripToDriver,
  updateTripDetailsByDriver,
  driverAssignCab
};

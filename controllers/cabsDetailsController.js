const redisClient = require("../config/redisClient");
const Cab = require("../models/CabsDetails");
const Driver = require("../models/loginModel");
const CabAssignment = require("../models/CabAssignment");


exports.addCab = async (req, res) => {
  try {
    console.log("📝 Request Body:", req.body);
    console.log("📂 Uploaded Files:", req.files);

    const { cabNumber, insuranceNumber, insuranceExpiry, registrationNumber } = req.body;

    if (!cabNumber) {
      return res.status(400).json({ message: "Cab number is required" });
    }

    const existingCab = await Cab.findOne({ cabNumber });

    if (existingCab) {
      return res.status(400).json({ message: "Cab number already exists" });
    }

    const cabImage = req.files?.cabImage?.[0]?.path || null;

    const newCab = new Cab({
      cabNumber,
      insuranceNumber: insuranceNumber || '',
      insuranceExpiry: insuranceExpiry || null,
      registrationNumber: registrationNumber || '',
      cabImage: cabImage || '',
      addedBy: req.admin?.id || '',
    });

    await newCab.save();

    // ✅ Invalidate Redis cache for cab lists if any exist (example keys shown)
    await redisClient.del('cabList:all');
    await redisClient.del(`cabList:admin:${req.admin?.id}`);
    console.log("🧹 Redis cache invalidated for cab lists");

    return res.status(201).json({ message: "New cab created successfully", cab: newCab });

  } catch (error) {
    console.error("🚨 Error creating cab:", error);
    return res.status(500).json({
      message: "Error creating cab",
      error: error?.message || "Internal Server Error"
    });
  }
};

exports.driverAdd = async (req, res) => {
  try {
    console.log("📝 Request Body:", req.body);
    console.log("📂 Uploaded Files:", req.files);

    const { cabNumber, ...updateFields } = req.body;

    if (!cabNumber) {
      return res.status(400).json({ message: "Cab number is required" });
    }

    let existingCab = await Cab.findOne({ cabNumber });

    const parseJSONSafely = (data, defaultValue = {}) => {
      if (!data) return defaultValue;
      try {
        return typeof data === "string" ? JSON.parse(data) : data;
      } catch (error) {
        console.error(`JSON Parsing Error for ${data}:`, error.message);
        return defaultValue;
      }
    };

    const calculateKmTravelled = (meterReadings) => {
      let totalMeters = 0;
      for (let i = 1; i < meterReadings.length; i++) {
        const diff = meterReadings[i] - meterReadings[i - 1];
        if (diff > 0) {
          totalMeters += diff;
        }
      }
      return Math.round(totalMeters);
    };

    const parsedFuel = parseJSONSafely(updateFields.fuel);
    const parsedFastTag = parseJSONSafely(updateFields.fastTag);
    const parsedTyre = parseJSONSafely(updateFields.tyrePuncture);
    const parsedService = parseJSONSafely(updateFields.vehicleServicing);
    const parsedOther = parseJSONSafely(updateFields.otherProblems);

    const uploadedImages = {
      fuel: {
        receiptImage: req.files?.receiptImage?.[0]?.path || existingCab?.fuel?.receiptImage,
        transactionImage: req.files?.transactionImage?.[0]?.path || existingCab?.fuel?.transactionImage,
      },
      tyrePuncture: {
        image: req.files?.punctureImage?.[0]?.path || existingCab?.tyrePuncture?.image,
      },
      vehicleServicing: {
        image: req.files?.vehicleServicingImage?.[0]?.path,
        receiptImage: req.files?.vehicleServicingReceiptImage?.[0]?.path,
      },
      otherProblems: {
        image: req.files?.otherProblemsImage?.[0]?.path || existingCab?.otherProblems?.image,
      },
      cabImage: req.files?.cabImage?.[0]?.path || existingCab?.cabImage,
    };

    let updatedMeter = [...(existingCab?.vehicleServicing?.meter || [])];
    if (parsedService?.meter) {
      const newMeter = Number(parsedService.meter);
      if (!isNaN(newMeter)) {
        updatedMeter.push(newMeter);
      }
    }
    const kmTravelled = calculateKmTravelled(updatedMeter);

    let vehicleServicingData = existingCab?.vehicleServicing || {};
    if (
      parsedService ||
      uploadedImages.vehicleServicing.image ||
      uploadedImages.vehicleServicing.receiptImage
    ) {
      vehicleServicingData = {
        ...vehicleServicingData,
        ...parsedService,
        meter: updatedMeter,
        kmTravelled,
        image: [
          ...(existingCab?.vehicleServicing?.image || []),
          ...(uploadedImages.vehicleServicing.image ? [uploadedImages.vehicleServicing.image] : [])
        ],
        receiptImage: [
          ...(existingCab?.vehicleServicing?.receiptImage || []),
          ...(uploadedImages.vehicleServicing.receiptImage ? [uploadedImages.vehicleServicing.receiptImage] : [])
        ],
        amount: [
          ...(existingCab?.vehicleServicing?.amount || []),
          ...(Array.isArray(parsedService?.amount)
            ? parsedService.amount
            : parsedService?.amount ? [parsedService.amount] : [])
        ],
        totalKm: parsedService?.totalKm || existingCab?.vehicleServicing?.totalKm,
      };
    }

    const updateData = {
      cabNumber,
      insuranceNumber: updateFields.insuranceNumber || existingCab?.insuranceNumber,
      insuranceExpiry: updateFields.insuranceExpiry || existingCab?.insuranceExpiry,
      registrationNumber: updateFields.registrationNumber || existingCab?.registrationNumber,
      location: { ...existingCab?.location, ...parseJSONSafely(updateFields.location) },
      fuel: { ...existingCab?.fuel, ...parsedFuel, ...uploadedImages.fuel },
      fastTag: { ...existingCab?.fastTag, ...parsedFastTag },
      tyrePuncture: { ...existingCab?.tyrePuncture, ...parsedTyre, ...uploadedImages.tyrePuncture },
      vehicleServicing: vehicleServicingData,
      otherProblems: { ...existingCab?.otherProblems, ...parsedOther, ...uploadedImages.otherProblems },
      cabImage: uploadedImages.cabImage,
      addedBy: req.admin?.id || existingCab?.addedBy,
    };

    let savedCab;

    if (!existingCab) {
      const newCab = new Cab(updateData);
      savedCab = await newCab.save();
    } else {
      savedCab = await Cab.findOneAndUpdate(
        { cabNumber },
        { $set: updateData },
        { new: true, runValidators: true }
      );
    }

    // ✅ Redis cache invalidation
    const redisKey = `cab:${cabNumber}`;
    await redisClient.del(redisKey);
    console.log(`🧹 Redis cache invalidated for cab key: ${redisKey}`);

    // Optionally: Invalidate admin cab list if you cache that
    if (savedCab.addedBy) {
      const adminCabListKey = `cabList:admin:${savedCab.addedBy}`;
      await redisClient.del(adminCabListKey);
      console.log(`🧹 Redis cache invalidated for admin cab list: ${adminCabListKey}`);
    }

    const message = existingCab ? "Cab data updated successfully" : "New cab created successfully";
    return res.status(existingCab ? 200 : 201).json({ message, cab: savedCab });

  } catch (error) {
    console.error("🚨 Error updating/creating cab:", error.message);
    res.status(500).json({ message: "Error updating/creating cab", error: error.message });
  }
};

exports.getCab = async (req, res) => {
    const adminId = req.admin.id;
    const redisKey = `cabList:admin:${adminId}`;
  
    try {
      // 1. Try Redis cache first
      const cachedData = await redisClient.get(redisKey);
      if (cachedData) {
        console.log("✅ Returning cached cabs for admin:", adminId);
        return res.status(200).json(JSON.parse(cachedData));
      }
  
      // 2. If not cached, fetch from DB
      const cabs = await Cab.find({ addedBy: adminId });
  
      // 3. Cache result
      await redisClient.set(redisKey, JSON.stringify(cabs), 'EX', 3600); // 1 hour cache
  
      return res.status(200).json(cabs);
    } catch (error) {
      console.error("🚨 Error in getCab:", error);
      return res.status(500).json({ error: "Server error", details: error.message });
    }
  };
  
  exports.driverCab = async (req, res) => {
    const driverId = req.driver.id;
  
    try {
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
  
      const adminId = driver.addedBy;
      const redisKey = `driver:${driverId}:cabListFromAdmin:${adminId}`;
  
      // 1. Check Redis for cached cabs
      const cachedCabs = await redisClient.get(redisKey);
      if (cachedCabs) {
        console.log("✅ Returning cached admin cabs for driver:", driverId);
        return res.status(200).json({ "Driver Detail": driver, "Cab Admin": JSON.parse(cachedCabs) });
      }
  
      // 2. Fetch from DB if not in cache
      const adminsCab = await Cab.find({ addedBy: adminId });
  
      // 3. Cache it
      await redisClient.set(redisKey, JSON.stringify(adminsCab), 'EX', 3600); // 1 hour
  
      return res.status(200).json({ "Driver Detail": driver, "Cab Admin": adminsCab });
  
    } catch (error) {
      console.error("🚨 Error in driverCab:", error);
      return res.status(500).json({ error: "Server error", details: error.message });
    }
  };

// 🚀 GET Cab by ID with Redis Cache
exports.getById = async (req, res) => {
  const cabId = req.params.id;
  const redisKey = `cab:${cabId}`;

  try {
    // 1. Check Redis cache
    const cachedCab = await redisClient.get(redisKey);
    if (cachedCab) {
      console.log(`✅ Cache hit for cab ${cabId}`);
      return res.status(200).json(JSON.parse(cachedCab));
    }

    // 2. Fetch from DB
    const cab = await Cab.findById(cabId).populate("addedBy", "name email");
    if (!cab) return res.status(404).json({ error: "Cab not found" });

    // 3. Cache result
    await redisClient.set(redisKey, JSON.stringify(cab), 'EX', 3600); // Cache for 1 hour
    console.log(`💾 Cached cab ${cabId}`);

    res.status(200).json(cab);
  } catch (error) {
    console.error("🚨 Error in getById:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ❌ DELETE Cab and Invalidate Redis
exports.deleteCab = async (req, res) => {
  const cabId = req.params.id;
  const redisKey = `cab:${cabId}`;

  try {
    const cab = await Cab.findById(cabId);
    if (!cab) return res.status(404).json({ error: "Cab not found" });

    const adminId = cab.addedBy;

    // 1. Delete from MongoDB
    await cab.deleteOne();

    // 2. Invalidate Redis keys
    const keysToDelete = [
      redisKey,
      `cabList:admin:${adminId}`,
      `cabList:all`
    ];
    await Promise.all(keysToDelete.map(k => redisClient.del(k)));
    console.log(`🧹 Deleted cab and invalidated Redis keys: ${keysToDelete.join(', ')}`);

    res.status(200).json({ message: "Cab deleted successfully" });
  } catch (error) {
    console.error("🚨 Error in deleteCab:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
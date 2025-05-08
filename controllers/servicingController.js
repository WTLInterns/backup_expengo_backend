const Servicing = require("../models/ServicingAssignment");
const redisClient = require("../config/redisClient");

// Utility: cache helper
const cacheData = async (key, fetchFn, expiry = 60) => {
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached);

    const freshData = await fetchFn();
    await redisClient.setEx(key, expiry, JSON.stringify(freshData));
    return freshData;
};

// ✅ Assign servicing (admin only)
exports.assignServicing = async (req, res) => {
    try {
        const { cabId, driverId, serviceDate } = req.body;

        const newService = await new Servicing({
            cab: cabId,
            driver: driverId,
            assignedBy: req.admin.id,
            serviceDate,
        }).save();

        // Invalidate related caches
        await Promise.all([
            redisClient.del(`servicings:driver:${driverId}`),
            redisClient.del(`servicings:admin:${req.admin.id}`)
        ]);

        res.status(201).json({
            message: "Cab assigned for servicing",
            servicing: newService,
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", details: err.message });
    }
};

// ✅ Driver updates status with receipt and cost
exports.updateServicingStatus = async (req, res) => {
    try {
        const servicing = await Servicing.findById(req.params.id);
        if (!servicing) return res.status(404).json({ error: "Servicing not found" });
        if (servicing.driver.toString() !== req.driver.id)
            return res.status(403).json({ error: "Unauthorized" });

        servicing.receiptImage = req.file?.path || servicing.receiptImage;
        servicing.servicingAmount = req.body.servicingCost || servicing.servicingAmount;
        servicing.status = "completed";

        await servicing.save();

        // Invalidate driver's servicing cache
        await redisClient.del(`servicings:driver:${req.driver.id}`);

        res.status(200).json({
            message: "Servicing updated successfully",
            servicing,
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", details: err.message });
    }
};

// ✅ Driver gets assigned (pending) servicings
exports.getAssignedServicings = async (req, res) => {
    try {
        const key = `servicings:driver:${req.driver.id}`;
        const services = await cacheData(key, () =>
            Servicing.find({ driver: req.driver.id, status: "pending" })
                .populate("cab")
                .populate("driver")
        );

        res.status(200).json({ services });
    } catch (err) {
        res.status(500).json({ error: "Server error", details: err.message });
    }
};

// ✅ Admin gets all assigned servicings
exports.getAssignedServicingsAdmin = async (req, res) => {
    try {
        const key = `servicings:admin:${req.admin.id}`;
        const services = await cacheData(key, () =>
            Servicing.find({ assignedBy: req.admin.id })
                .populate("cab")
                .populate("driver")
        );

        res.status(200).json({ services });
    } catch (err) {
        res.status(500).json({ error: "Server error", details: err.message });
    }
};

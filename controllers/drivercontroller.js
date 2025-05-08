const Driver = require("../models/Driver");
const redisClient = require("../config/redisClient");

// Register Driver
const registerDriver = async (req, res) => {
    try {
        const newDriver = new Driver(req.body);
        await newDriver.save();

        // Optional: Cache the new driver
        await redisClient.setEx(`driver:${newDriver._id}`, 3600, JSON.stringify(newDriver)); // expires in 1 hour

        res.status(201).json({ message: "Driver registered successfully", driver: newDriver });
    } catch (error) {
        res.status(500).json({ message: "Error registering driver", error });
    }
};

// Driver Login
const driverLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const driver = await Driver.findOne({ email });

        if (!driver || driver.password !== password) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        res.status(200).json({ message: "Login successful", driver });
    } catch (error) {
        res.status(500).json({ message: "Error logging in", error });
    }
};

// Get Driver Details by ID (with Redis cache)
const getDriverDetails = async (req, res) => {
    const { driverId } = req.params;

    try {
        // Check Redis cache
        const cachedDriver = await redisClient.get(`driver:${driverId}`);
        if (cachedDriver) {
            return res.status(200).json(JSON.parse(cachedDriver));
        }

        // If not in cache, fetch from DB
        const driver = await Driver.findById(driverId);
        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        // Cache the driver data for next time (1 hour)
        await redisClient.setEx(`driver:${driverId}`, 3600, JSON.stringify(driver));

        res.status(200).json(driver);
    } catch (error) {
        res.status(500).json({ message: "Error retrieving driver details", error });
    }
};

module.exports = { registerDriver, driverLogin, getDriverDetails };

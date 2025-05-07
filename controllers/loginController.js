const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const Driver = require("../models/loginModel");
const redisClient = require("../config/redisClient");
require("dotenv").config();

const resend = new Resend(process.env.RESEND_API_KEY);

// ----------------------
// Register New Driver
// ----------------------
const registerUser = async (req, res) => {
  try {
    const { name, email, phone, licenseNo, adharNo, addedBy } = req.body;
    const profileImage = req.files?.profileImage?.[0]?.path || "";
    const licenseNoImage = req.files?.licenseNoImage?.[0]?.path || "";
    const adharNoImage = req.files?.adharNoImage?.[0]?.path || "";

    if (![name, email, phone, licenseNo, adharNo].every(field => field?.trim())) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!/^\d{12}$/.test(adharNo)) {
      return res.status(400).json({ error: "Aadhaar number must be 12 digits" });
    }

    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: "Phone number must be 10 digits" });
    }

    const existing = await Driver.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Driver with this email already exists" });
    }

    const password = phone;

    const newDriver = new Driver({
      name,
      email,
      password,
      phone,
      licenseNo,
      adharNo,
      profileImage,
      licenseNoImage,
      adharNoImage,
      addedBy,
    });

    await newDriver.save();

    // Optional: store registered user briefly in Redis
    // await redisClient.setEx(`driver:${newDriver._id}`, 300, JSON.stringify(newDriver));

    res.status(201).json({
      message: "Driver registered successfully",
      user: {
        _id: newDriver._id,
        name,
        email,
        phone,
        licenseNo,
        adharNo,
        profileImage,
        licenseNoImage,
        adharNoImage,
        addedBy,
        createdAt: newDriver.createdAt,
      },
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: "Error registering driver", error: err.message });
  }
};

// ----------------------
// Driver Login (with rate limiting)
// ----------------------
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password?.trim()) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Rate limiting (max 5 attempts per minute per email)
    const rateKey = `login-rate:${email}`;
    const attempts = await redisClient.incr(rateKey);
    if (attempts === 1) await redisClient.expire(rateKey, 60); // 1 minute
    if (attempts > 5) {
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }

    const user = await Driver.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "10d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        licenseNo: user.licenseNo,
        adharNo: user.adharNo,
        profileImage: user.profileImage,
        addedBy: user.addedBy,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Error logging in", error: err.message });
  }
};

module.exports = { registerUser, loginUser };

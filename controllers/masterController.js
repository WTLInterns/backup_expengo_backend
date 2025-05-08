const bcrypt = require('bcryptjs');
const MasterAdmin = require('../models/masterAdmin');
const { Resend } = require("resend");
const Driver = require("../models/loginModel");
const CabDetails = require("../models/CabsDetails");
const CabAssigned = require("../models/CabAssignment");
const redisClient = require("../config/redisClient"); 

const resend = new Resend(process.env.RESEND_API_KEY);

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Register Master Admin (not regular admin)
exports.registerMasterAdmin = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check if Master Admin already exists
        let existingMasterAdmin = await MasterAdmin.findOne({ email });
        if (existingMasterAdmin) return res.status(400).json({ message: "Master Admin already registered" });

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);
        const newMasterAdmin = new MasterAdmin({ name, email, password: hashedPassword });

        await newMasterAdmin.save();

        res.status(201).json({ message: "Master Admin registered successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin Login (for Master Admin)
exports.adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if Master Admin exists
        const masterAdmin = await MasterAdmin.findOne({ email });
        if (!masterAdmin) return res.status(404).json({ message: "Master Admin not found" });

        // Compare hashed password with entered password
        const isMatch = await bcrypt.compare(password, masterAdmin.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        res.status(200).json({ message: "Login successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

// 📩 Send OTP
exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const user = await MasterAdmin.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = generateOTP();
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 10); // 10 mins validity

    // Store OTP in Redis with an expiration time of 10 minutes
    await redisClient.setEx(`otp:${email}`, 600, otp); // OTP stored with 600 seconds expiry

    await resend.emails.send({
      from: `"WTL Tourism Pvt. Ltd." <contact@worldtriplink.com>`,
      to: email,
      subject: "Password Reset OTP",
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h2>Password Reset Request</h2>
          <p>Your OTP is:</p>
          <div style="font-size: 32px; font-weight: bold; color: #1e90ff;">${otp}</div>
          <p>This OTP is valid for 10 minutes.</p>
        </div>
      `,
    });

    return res.status(200).json({ message: "OTP sent to your email" });
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Verify OTP
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

  try {
    const user = await MasterAdmin.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Retrieve OTP from Redis
    const storedOTP = await redisClient.get(`otp:${email}`);

    if (!storedOTP) return res.status(400).json({ message: "OTP expired or not found. Please request a new one" });
    if (storedOTP !== otp) return res.status(400).json({ message: "Invalid OTP" });

    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// 🔐 Reset Password
exports.resetPassword = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

  try {
    const user = await MasterAdmin.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const hashedPassword = await bcrypt.hash(password, 12);

    await MasterAdmin.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      resetOTP: null,
      resetOTPExpiry: null,
    });

    // Remove OTP from Redis after password reset
    await redisClient.del(`otp:${email}`);

    return res.status(200).json({ message: "Password reset successful" });
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getCabDetails = async (req, res) => {
  try {
    const adminId = req.query.admin; // Get logged-in admin's ID

    // Fetch only drivers assigned to this admin
    const drivers = await Driver.find({ addedBy: adminId });
    const cabs = await CabDetails.find({ addedBy: adminId });
    const assignedCabs = await CabAssigned.find({ assignedBy: adminId });

    res.status(200).json({
      totalDrivers: drivers.length,
      totalCabs: cabs.length,
      totalCabAssigned: assignedCabs.length,
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

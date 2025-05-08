
const Driver = require("../models/loginModel");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const redisClient = require("../config/redisClient"); 
require("dotenv").config();

// ✅ Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ Send OTP for Forgot Password
const sendResetOTP = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Check if OTP is cached in Redis
    const cachedOTP = await redisClient.get(email);
    if (cachedOTP) {
      return res.status(400).json({ message: "An OTP has already been sent recently. Please wait before requesting another." });
    }

    const user = await Driver.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Generate OTP and Expiry Time
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes expiry

    // ✅ Save OTP in Database
    user.resetOTP = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Cache OTP in Redis with an expiry time (3 minutes)
    await redisClient.set(email, otp, 'EX', 180);

    // ✅ Send Email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is: ${otp}. It is valid for 3 minutes.`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return res.status(500).json({ message: "Failed to send OTP" });
      } else {
        return res.status(200).json({ message: "OTP sent successfully" });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Verify OTP
const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await Driver.findOne({ email });
    if (!user || user.resetOTP !== parseInt(otp)) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // ✅ Check if OTP is expired
    if (user.otpExpiry < Date.now()) {
      return res.status(400).json({ message: "OTP expired. Please request a new one." });
    }

    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Change Password after OTP Verification
const changePassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, OTP, and new password are required" });
  }

  try {
    const driver = await Driver.findOne({ email });
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // ✅ Validate OTP from Redis cache
    const cachedOTP = await redisClient.get(email);
    if (!cachedOTP || cachedOTP !== otp.toString()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // ✅ Hash and Update Password
    driver.password = await bcrypt.hash(newPassword, 12);
    driver.resetOTP = null; // Remove OTP after password reset
    driver.otpExpiry = null;
    await driver.save();

    // Delete OTP from Redis
    await redisClient.del(email);

    res.status(200).json({ message: "Password changed successfully" });

  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Export Controller Functions
module.exports = { sendResetOTP, verifyOTP, changePassword };

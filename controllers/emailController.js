
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken"); // Import JWT
const Admin = require("../models/Admin"); // Assuming your Admin model is in models/Admin.js
const redisClient = require("../config/redisClient");


// Configure email transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number.parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};


// Function to generate a random password
const generateRandomPassword = () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 12 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
};

// Function to send email and create sub-admin
const sendSubAdminEmail = async (req, res) => {
  try {
    const { email, name, role, phone } = req.body;

    // Validate required fields
    if (!email || !name || !phone) {
      return res.status(400).json({
        success: false,
        message: "Email, name, and phone are required",
      });
    }

    // Check if the sub-admin email already exists in Redis cache
    const cachedAdmin = await redisClient.get(email);
    if (cachedAdmin) {
      return res.status(400).json({
        success: false,
        message: "This email is already registered for a sub-admin",
      });
    }

    // Generate a random password and hash it
    const password = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new sub-admin in the database
    const newAdmin = new Admin({
      name,
      email,
      password: hashedPassword,
      role: role || "sub-admin", // Default to "sub-admin" if role not provided
      phone,
    });

    await newAdmin.save();

    // Store the new sub-admin email in Redis cache
    await redisClient.set(email, JSON.stringify({ name, email, role, phone }), 'EX', 3600); // Cache for 1 hour

    // Create a transporter for sending the email
    const transporter = createTransporter();

    // Define the email options
    const mailOptions = {
      from: `"Admin Portal" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Sub-Admin Account Details",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4; border-radius: 8px; width: 600px; margin: 0 auto;">
          <div style="text-align: center;">
            <img src="https://media.licdn.com/dms/image/v2/D4D03AQGliPQEWM90Ag/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1732192083386?e=2147483647&v=beta&t=jZaZ72VS6diSvadKUEgQAOCd_0OKpVbeP44sEOrh-Og" 
                 alt="WTL Tourism Logo" style="width: 100px; height: 100px; border-radius: 50%; margin-bottom: 10px;">
            <h1 style="color: #2c3e50; font-size: 24px; font-weight: bold;">WTL Tourism Pvt Ltd</h1>
          </div>
          <div style="background-color: #ffffff; padding: 20px; border-radius: 8px;">
            <h2 style="color: #2c3e50; font-size: 22px; text-align: center;">Welcome, ${name}!</h2>
            <p style="color: #34495e; font-size: 16px; line-height: 1.6;">
              We're excited to have you as a sub-admin in the WTL Tourism team. Below are your login details:
            </p>
            <div style="background-color: #f9fafb; padding: 10px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #34495e; font-size: 16px; line-height: 1.6;">
              Please log in using the credentials provided above. After logging in, we recommend you change your password for security reasons.
            </p>
            <div style="text-align: center; padding-top: 20px;">
              <p style="color: #7f8c8d; font-size: 14px;">If you have any questions, feel free to contact our support team.</p>
            </div>
          </div>
        </div>
      `,
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);

    // Respond with success message
    return res.json({
      success: true,
      message: "Sub-admin created and email sent successfully",
      messageId: info.messageId,
    });
  } catch (error) {
    console.error("Error creating sub-admin or sending email:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating sub-admin or sending email",
      error: error.message,
    });
  }
};


const loginSubAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if email and password are provided
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // Check if the admin data is cached in Redis
    const cachedAdmin = await redisClient.get(email);
    let admin;

    if (cachedAdmin) {
      admin = JSON.parse(cachedAdmin);
    } else {
      // Find the admin by email if not found in cache
      admin = await Admin.findOne({ email });

      if (!admin) {
        return res.status(404).json({ success: false, message: "Admin not found" });
      }

      // Cache the admin data for quick future lookups (expires in 1 hour)
      await redisClient.set(email, JSON.stringify(admin), 'EX', 3600); 
    }

    // Compare provided password with the stored hashed password
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Create a JWT token (expires in 1 hour)
    const token = jwt.sign({ id: admin._id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, {
      expiresIn: "1h", // token will expire in 1 hour
    });

    // Respond with success and the token
    return res.json({
      success: true,
      message: "Login successful",
      token, // Send the JWT token
      admin: {
        name: admin.name,
        email: admin.email,
        role: admin.role,
        phone: admin.phone,
        status: admin.status,
      },
    });
  } catch (error) {
    console.error("Error during login:", error); // More specific error log
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports = { sendSubAdminEmail, loginSubAdmin };




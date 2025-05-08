const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Cab = require("../models/CabAssignment");
const Driver = require("../models/loginModel");
const CabDetails = require("../models/CabsDetails");
require("dotenv").config();
const Expense = require("../models/subAdminExpenses");
const Analytics = require("../models/SubadminAnalytics");
const nodemailer = require("nodemailer");
const crypto = require('crypto');
const redisClient = require("../config/redisClient");


// const Expense = require("../models/Expense");

// ✅ Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


// ✅ Register Admin
const registerAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if admin already exists
    let existingAdmin = await Admin.findOne({ email });
    if (existingAdmin)
      return res.status(400).json({ message: "Admin already registered" });

    // ✅ Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({ email, password: hashedPassword });

    await newAdmin.save();

    // ✅ Invalidate related Redis cache (if any)
    await redisClient.del("adminList");

    res.status(201).json({ message: "Admin registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};



const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    if (admin.status === "Blocked") {
      return res
        .status(403)
        .json({ message: "Your account is blocked. Contact admin." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "10d" }
    );

    // ✅ Store token in Redis (key: admin ID, value: token)
    await redisClient.set(`admin-token:${admin._id}`, token, {
      EX: 864000, // 10 days in seconds
    });

    res
      .status(200)
      .json({ message: "Login successful!", token, id: admin._id });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};


const totalSubAdminCount = async (req, res) => {
  try {
    // Check Redis cache first
    const cachedCount = await redisClient.get("totalSubAdminCount");

    if (cachedCount) {
      return res.status(200).json({ count: Number(cachedCount), fromCache: true });
    }

    // Count from DB
    const subAdminCount = await Admin.countDocuments();

    // Store in Redis with 60 seconds expiry
    await redisClient.setEx("totalSubAdminCount", 60, subAdminCount.toString());

    res.status(200).json({ count: subAdminCount, fromCache: false });
  } catch (error) {
    res.status(500).json({ message: "Error counting sub-admins", error: error.message });
  }
};

const totalDriver = async (req, res) => {
  try {
    const cachedDriverCount = await redisClient.get("totalDriverCount");

    if (cachedDriverCount) {
      return res.status(200).json({ count: Number(cachedDriverCount), fromCache: true });
    }

    const driverCount = await Driver.countDocuments();

    await redisClient.setEx("totalDriverCount", 60, driverCount.toString());

    res.status(200).json({ count: driverCount, fromCache: false });
  } catch (error) {
    res.status(500).json({ message: "Error counting drivers", error: error.message });
  }
};

// ✅ Get total number of cabs with Redis cache

const totalCab = async (req, res) => {
  try {
    const cachedCabCount = await redisClient.get("totalCabCount");

    if (cachedCabCount) {
      return res.status(200).json({ count: Number(cachedCabCount), fromCache: true });
    }

    const cabCount = await Cab.countDocuments();
    await redisClient.setEx("totalCabCount", 60, cabCount.toString()); // Cache for 60 seconds

    res.status(200).json({ count: cabCount, fromCache: false });
  } catch (error) {
    res.status(500).json({ message: "Error counting cabs", error: error.message });
  }
};


// ✅ Get all sub-admins with Redis cache
const getAllSubAdmins = async (req, res) => {
  try {
    const cachedSubAdmins = await redisClient.get("allSubAdmins");

    if (cachedSubAdmins) {
      return res.status(200).json({
        success: true,
        subAdmins: JSON.parse(cachedSubAdmins),
        fromCache: true,
      });
    }

    const subAdmins = await Admin.find().select("-password").sort({ createdAt: -1 });
    await redisClient.setEx("allSubAdmins", 60, JSON.stringify(subAdmins)); // Cache for 60 seconds

    res.status(200).json({ success: true, subAdmins, fromCache: false });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch sub-admins",
      error: error.message,
    });
  }
};



// Invoice number generator
const generateInvoiceNumber = (subadminName) => {
  if (!subadminName) return "NA-000000";

  const namePrefix = subadminName.trim().split(" ").map((word) => word[0]).join("").toUpperCase().slice(0, 3); // E.g., Radiant IT Service → RIS
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear() % 100;
  const nextYear = (now.getFullYear() + 1) % 100;
  const financialYear =currentMonth >= 4 ? `${currentYear}${nextYear}` : `${(currentYear - 1).toString().padStart(2, "0")}${currentYear}`;
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return `${namePrefix}${financialYear}-${randomNumber}`;
};

// Controller to add a new sub-admin
const addNewSubAdmin = async (req, res) => {
  try {
    const { name, email, role, phone, status, companyInfo } = req.body;

    const profileImage = req.files?.profileImage?.[0]?.path || null;
    const companyLogo = req.files?.companyLogo?.[0]?.path || null;
    const signature = req.files?.signature?.[0]?.path || null;

    // Basic validation
    if (!name || !email || !role || !phone || !companyInfo) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided.",
      });
    }

    // Check for existing email
    const existingSubAdmin = await Admin.findOne({ email });
    if (existingSubAdmin) {
      return res.status(400).json({
        success: false,
        message: "Email already in use",
      });
    }

    // Generate and hash password
    const generatedPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    // Create subadmin
    const newSubAdmin = await Admin.create({
      profileImage,
      name,
      email,
      password: hashedPassword,
      role,
      phone,
      status: status || "Active",
      companyLogo,
      companyInfo,
      signature,
    });

    // Optionally generate invoice number
    const invoiceNumber = generateInvoiceNumber(newSubAdmin.name);

    // Send welcome email
    const mailOptions = {
      from: `"WTL Tourism Pvt. Ltd." <contact@worldtriplink.com>`,
      to: email,
      subject: "Welcome to WTL Tourism - Sub-Admin Account Created",
      html: `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif;">
          <div style="text-align: center; padding-bottom: 20px;">
            ${companyLogo ? `<img src="${companyLogo}" alt="Company Logo" style="max-width: 120px;">` : ""}
          </div>
          <h2 style="text-align: center; color: #333;">Sub-Admin Account Created</h2>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Password:</strong> ${generatedPassword}</p>
          <p>Please log in and change your password after first login.</p>
          <br>
          <div style="text-align: center;">
            <a href="http://localhost:3000/" style="background: #007BFF; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Login Now</a>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    // Invalidate Redis cache
    await redisClient.del("allSubAdmins");
    await redisClient.del("totalSubAdminCount");

    // Return response without password
    const { password: _, ...subAdminResponse } = newSubAdmin.toObject();

    return res.status(201).json({
      success: true,
      message: "Sub-admin created successfully",
      newSubAdmin: subAdminResponse,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to add sub-admin",
      error: error.message,
    });
  }
};



// Get a single sub-admin by ID
const getSubAdminById = async (req, res) => {
  try {
    // Check Redis cache first
    const cachedSubAdmin = await redisClient.get(`subAdmin:${req.params.id}`);

    if (cachedSubAdmin) {
      return res.status(200).json({
        success: true,
        subAdmin: JSON.parse(cachedSubAdmin),
      });
    }

    const subAdmin = await Admin.findById(req.params.id).select("-password");

    if (!subAdmin) {
      return res
        .status(404)
        .json({ success: false, message: "Sub-admin not found" });
    }

    // Cache the result in Redis for future use
    await redisClient.set(
      `subAdmin:${req.params.id}`,
      JSON.stringify(subAdmin),
      "EX",
      3600 // Cache expiry time in seconds (1 hour)
    );

    res.status(200).json({ success: true, subAdmin });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch sub-admin",
      error: error.message,
    });
  }
};

const updateSubAdmin = async (req, res) => {
  try {
    const { name, email, password, role, phone, status, profileImage } =
      req.body;

    const subAdminId = req.params.id;

    // Check if email is being changed and already exists
    if (email) {
      const existingSubAdmin = await Admin.findOne({
        email,
        _id: { $ne: subAdminId },
      });
      if (existingSubAdmin) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another sub-admin",
        });
      }
    }

    // Prepare update data
    const updateData = { name, email, role, phone, status };

    if (profileImage !== undefined) {
      updateData.profileImage = profileImage;
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // Update the sub-admin
    const updatedSubAdmin = await Admin.findByIdAndUpdate(
      subAdminId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedSubAdmin) {
      return res
        .status(404)
        .json({ success: false, message: "Sub-admin not found" });
    }

    // Invalidate Redis cache
    await redisClient.del(`subAdmin:${subAdminId}`);
    await redisClient.del("allSubAdmins");
    await redisClient.del("totalSubAdminCount");

    res.status(200).json({
      success: true,
      message: "Sub-admin updated successfully",
      subAdmin: updatedSubAdmin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update sub-admin",
      error: error.message,
    });
  }
};


const deleteSubAdmin = async (req, res) => {
  try {
    // Find and delete the sub-admin
    const deletedSubAdmin = await Admin.findByIdAndDelete(req.params.id);

    if (!deletedSubAdmin) {
      return res.status(404).json({ success: false, message: "Sub-admin not found" });
    }

    // Delete related cabs and drivers (assuming cab and driver are related to sub-admin)
    const deletedCabs = await Cab.deleteMany({ addedBy: req.params.id }); // Modify based on your schema
    const deletedDrivers = await Driver.deleteMany({ addedBy: req.params.id }); // Modify based on your schema

    // Check if related cabs and drivers are deleted
    const relatedDataDeleted = deletedCabs.deletedCount > 0 || deletedDrivers.deletedCount > 0;

    // If no related cabs or drivers are deleted, it's still fine to delete the sub-admin
    if (!relatedDataDeleted) {
      console.log("No related cabs or drivers to delete");
    }

    // Invalidate Redis cache for the deleted sub-admin and related data
    await redisClient.del(`subAdmin:${req.params.id}`);
    await redisClient.del("allSubAdmins");
    await redisClient.del("totalSubAdminCount");
    
    // Optionally, clear cache for any related cabs and drivers if needed
    await redisClient.del(`cabsAddedBy:${req.params.id}`);
    await redisClient.del(`driversAddedBy:${req.params.id}`);

    // Send success response
    res.status(200).json({
      success: true,
      message: "Sub-admin and related cabs and drivers deleted successfully, if any",
      deletedSubAdmin,
      deletedCabs,
      deletedDrivers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete sub-admin and related data",
      error: error.message,
    });
  }
};



// Toggle block status
const toggleBlockStatus = async (req, res) => {
  try {
    const subAdminId = req.params.id;

    // Check if the sub-admin exists in the database
    const subAdmin = await Admin.findById(subAdminId);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: "Sub-admin not found" });
    }

    // Toggle the status
    const newStatus = subAdmin.status === "Active" ? "Inactive" : "Active";

    // Update the sub-admin's status
    const updatedSubAdmin = await Admin.findByIdAndUpdate(
      subAdminId,
      { $set: { status: newStatus } },
      { new: true }
    ).select("-password");

    // Invalidate Redis cache for the sub-admin and related data
    await redisClient.del(`subAdmin:${subAdminId}`);
    await redisClient.del("allSubAdmins"); // Invalidate cache for all sub-admins
    await redisClient.del("totalSubAdminCount"); // Invalidate cache for total sub-admin count
    
    // Optionally, you can invalidate specific cache for the sub-admin's data if needed
    await redisClient.del(`cabsAddedBy:${subAdminId}`);
    await redisClient.del(`driversAddedBy:${subAdminId}`);

    // Send success response with updated sub-admin details
    res.status(200).json({
      success: true,
      message: `Sub-admin ${newStatus === "Active" ? "activated" : "deactivated"} successfully`,
      status: newStatus,
      subAdmin: updatedSubAdmin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update sub-admin status",
      error: error.message,
    });
  }
};


// expense
const addExpense = async (req, res) => {
  try {
    const { type, amount, driver, cabNumber } = req.body;

    // Create a new expense entry
    const newExpense = new Expense({ type, amount, driver, cabNumber });

    // Save the expense to the database
    await newExpense.save();

    // Invalidate related cache entries
    await redisClient.del(`driverExpenses:${driver}`);
    await redisClient.del(`cabExpenses:${cabNumber}`);

    // Optionally, invalidate general expense data if you're caching it globally
    await redisClient.del("allExpenses");

    res.status(201).json({
      success: true,
      message: "Expense added successfully",
      expense: newExpense,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to add expense",
      error: error.message,
    });
  }
};


// Get all expenses
const getAllExpenses = async (req, res) => {
  try {
    const cacheKey = 'all_expenses';

    // Check Redis cache first
    const cachedExpenses = await redisClient.get(cacheKey);
    if (cachedExpenses) {
      return res.status(200).json({
        success: true,
        data: JSON.parse(cachedExpenses),
        cached: true,
      });
    }

    // Fetch all cabs and populate necessary fields
    const cabs = await Cab.find().populate('cab');

    if (cabs.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No cabs found for this admin.",
      });
    }

    const expenses = cabs.map((assign) => {
      const tripDetails = assign.tripDetails || {};
      const fuelAmounts = tripDetails.fuel?.amount || [];
      const fastTagAmounts = tripDetails.fastTag?.amount || [];
      const tyreRepairAmounts = tripDetails.tyrePuncture?.repairAmount || [];
      const otherAmounts = tripDetails.otherProblems?.amount || [];

      const fuelTotal = fuelAmounts.reduce((sum, val) => sum + (val || 0), 0);
      const fastTagTotal = fastTagAmounts.reduce((sum, val) => sum + (val || 0), 0);
      const tyreTotal = tyreRepairAmounts.reduce((sum, val) => sum + (val || 0), 0);
      const otherTotal = otherAmounts.reduce((sum, val) => sum + (val || 0), 0);

      const totalExpense = fuelTotal + fastTagTotal + tyreTotal + otherTotal;

      return {
        cabNumber: assign.cab?.cabNumber || "Unknown",
        totalExpense,
        breakdown: {
          fuel: fuelTotal,
          fastTag: fastTagTotal,
          tyrePuncture: tyreTotal,
          otherProblems: otherTotal,
        }
      };
    });

    expenses.sort((a, b) => b.totalExpense - a.totalExpense);

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No expenses found after calculation!",
      });
    }

    // Save processed data to Redis for 10 minutes (600 seconds)
    await redisClient.setEx(cacheKey, 600, JSON.stringify(expenses));

    res.status(200).json({
      success: true,
      data: expenses,
      cached: false,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};



// Delete an expense
const deleteExpense = async (req, res) => {
  try {
    const expenseId = req.params.id;

    // Remove the expense from the database
    const deletedExpense = await Expense.findByIdAndDelete(expenseId);
    if (!deletedExpense) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    // Invalidate the "all_expenses" cache so subsequent reads will refresh
    const cacheKey = 'all_expenses';
    try {
      const delCount = await redisClient.del(cacheKey);
      if (delCount > 0) {
        console.log(`Cache key "${cacheKey}" invalidated.`);
      }
    } catch (cacheErr) {
      console.error('Error invalidating cache:', cacheErr);
    }

    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully"
    });
  } catch (error) {
    console.error('Server Error in deleteExpense:', error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// Update an expense
const updateExpense = async (req, res) => {
  try {
    const { type, amount, driver, cabNumber } = req.body;
    const expenseId = req.params.id;

    const updatedExpense = await Expense.findByIdAndUpdate(
      expenseId,
      { type, amount, driver, cabNumber },
      { new: true, runValidators: true }
    );

    if (!updatedExpense) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    // Update individual expense cache
    try {
      await redisClient.setEx(`expense:${expenseId}`, 3600, JSON.stringify(updatedExpense));
      console.log(`Cache updated for expense ID: ${expenseId}`);
    } catch (err) {
      console.error("Error setting cache:", err);
    }

    // Invalidate the overall expenses list cache
    try {
      await redisClient.del('all_expenses');
      console.log(`'all_expenses' cache invalidated after update`);
    } catch (err) {
      console.error("Error invalidating all_expenses cache:", err);
    }

    return res.status(200).json({
      success: true,
      data: updatedExpense,
    });

  } catch (error) {
    console.error('Error in updateExpense:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


// Get all analytics data
const getAnalytics = async (req, res) => {
  try {
    const cacheKey = 'analytics:latest';

    // Check if data is cached
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('Returning analytics from cache');
      return res.status(200).json(JSON.parse(cachedData));
    }

    // If not cached, fetch from DB
    const data = await Analytics.find().sort({ date: -1 }).limit(10);

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'No analytics data found' });
    }

    // Cache the result
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
      console.log('Analytics data cached');
    } catch (cacheErr) {
      console.error('Error caching analytics data:', cacheErr);
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

// Add new analytics data
const addAnalytics = async (req, res) => {
  try {
    const { totalRides, revenue, customerSatisfaction, fleetUtilization } = req.body;

    const newEntry = new Analytics({
      totalRides,
      revenue,
      customerSatisfaction,
      fleetUtilization,
    });

    await newEntry.save();

    // Invalidate cache
    try {
      await redisClient.del('analytics:latest');
      console.log('Cache invalidated for analytics:latest');
    } catch (cacheErr) {
      console.error('Error invalidating cache:', cacheErr);
    }

    // Cache updated dataset (optional: refetch latest top 10 instead of just 1 new entry)
    try {
      const latestAnalytics = await Analytics.find().sort({ date: -1 }).limit(10);
      await redisClient.setEx('analytics:latest', 3600, JSON.stringify(latestAnalytics));
      console.log('Updated analytics cached');
    } catch (cacheErr) {
      console.error('Error caching latest analytics:', cacheErr);
    }

    return res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    console.error('Error adding data:', error);
    return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};



const getSubadminExpenses = async (req, res) => {
  try {
    const cacheKey = 'subadmin_expenses';

    // Check Redis cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('Serving subadmin expenses from cache');
      return res.status(200).json({ success: true, data: JSON.parse(cachedData) });
    }

    // Fetch necessary data in parallel
    const [subadmins, trips, drivers, cabDetails] = await Promise.all([
      Admin.find(),
      Cab.find().populate('cab').populate('assignedBy').populate('driver'),
      Driver.find(),
      CabDetails.find(),
    ]);

    if (!trips || trips.length === 0) {
      return res.status(404).json({ success: false, message: "No trips found!" });
    }

    const subadminExpenseMap = new Map();
    const driverLookup = new Map();
    const cabLookup = new Map();

    // Fill driver and cab lookup tables
    drivers.forEach(driver => {
      const id = driver.addedBy?._id?.toString();
      if (id) {
        driverLookup.set(id, (driverLookup.get(id) || 0) + 1);
      }
    });

    cabDetails.forEach(cab => {
      const id = cab.addedBy?.toString();
      if (id) {
        cabLookup.set(id, (cabLookup.get(id) || 0) + 1);
      }
    });

    // Process each trip
    trips.forEach(trip => {
      const subadminId = trip.assignedBy?._id?.toString();
      const subadminName = trip.assignedBy?.name || "N/A";
      if (!subadminId) return;

      const fuel = trip.tripDetails?.fuel?.amount?.reduce((a, b) => a + (b || 0), 0) || 0;
      const fastTag = trip.tripDetails?.fastTag?.amount?.reduce((a, b) => a + (b || 0), 0) || 0;
      const tyrePuncture = trip.tripDetails?.tyrePuncture?.repairAmount?.reduce((a, b) => a + (b || 0), 0) || 0;
      const otherProblems = trip.tripDetails?.otherProblems?.amount?.reduce((a, b) => a + (b || 0), 0) || 0;
      const totalExpense = fuel + fastTag + tyrePuncture + otherProblems;

      if (!subadminExpenseMap.has(subadminId)) {
        subadminExpenseMap.set(subadminId, {
          SubAdmin: subadminName,
          totalExpense: 0,
          breakdown: { fuel: 0, fastTag: 0, tyrePuncture: 0, otherProblems: 0 },
          tripCount: 0,
        });
      }

      const subadminData = subadminExpenseMap.get(subadminId);
      subadminData.totalExpense += totalExpense;
      subadminData.breakdown.fuel += fuel;
      subadminData.breakdown.fastTag += fastTag;
      subadminData.breakdown.tyrePuncture += tyrePuncture;
      subadminData.breakdown.otherProblems += otherProblems;
      subadminData.tripCount += 1;
    });

    // Add driver and cab counts
    subadminExpenseMap.forEach((subadminData, subadminId) => {
      subadminData.totalDrivers = driverLookup.get(subadminId) || 0;
      subadminData.totalCabs = cabLookup.get(subadminId) || 0;
    });

    const expenses = Array.from(subadminExpenseMap.values()).sort((a, b) => b.totalExpense - a.totalExpense);

    if (expenses.length === 0) {
      return res.status(404).json({ success: false, message: "No expenses found after calculation!" });
    }

    // Cache result
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(expenses));

    res.status(200).json({ success: true, data: expenses });
  } catch (error) {
    console.error("Error in getSubadminExpenses:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};



// ✅ Export all functions correctly
module.exports = {
  registerAdmin,
  adminLogin,
  totalSubAdminCount,
  getAllSubAdmins,
  addNewSubAdmin,
  getSubAdminById,
  updateSubAdmin,
  deleteSubAdmin,
  toggleBlockStatus,
  totalDriver,
  totalCab,
  addExpense,
  getAllExpenses,
  deleteExpense,
  updateExpense,
  getAnalytics,
  addAnalytics,
  getSubadminExpenses
};
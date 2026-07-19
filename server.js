const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'aps_lms_super_secret_key_123';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aps_lms';

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    seedAdmin();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// User Schema
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

// Configure custom serialization to match existing frontend expectations
UserSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const User = mongoose.model('User', UserSchema);

// Seed default admin if none exists
async function seedAdmin() {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      const newAdmin = new User({
        name: 'System Admin',
        email: 'admin@lms.com',
        password: hashedPassword,
        role: 'admin',
        status: 'approved'
      });
      await newAdmin.save();
      console.log('Default administrator user seeded successfully: admin@lms.com / admin123');
    }
  } catch (err) {
    console.error('Error seeding admin user:', err);
  }
}

// Authentication Middlewares
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided, authorization denied' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token is invalid or expired' });
  }
};

const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  });
};

// --- AUTH ROUTES ---

// Student Signup/Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Please provide name, email, and password.' });
  }

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUser = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'student',
      status: 'pending' // Student needs approval to log in
    });

    await newUser.save();

    // Return user info without password
    const userResponse = newUser.toJSON();
    delete userResponse.password;

    res.status(201).json({
      message: 'Registration request submitted successfully. Waiting for admin approval.',
      user: userResponse
    });
  } catch (error) {
    console.error('Registration database error:', error);
    res.status(500).json({ message: 'Database write failed.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Please provide email and password.' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    // CHECK APPROVAL STATUS FOR STUDENTS
    if (user.role === 'student' && user.status !== 'approved') {
      return res.status(403).json({
        message: 'Your registration request is pending admin approval. You cannot log in yet.'
      });
    }

    // Generate JWT Token
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });

    // Return user info without password
    const userResponse = user.toJSON();
    delete userResponse.password;

    res.json({
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Login database error:', error);
    res.status(500).json({ message: 'Server login error.' });
  }
});

// Get profile
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userResponse = user.toJSON();
    delete userResponse.password;

    res.json(userResponse);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server profile error.' });
  }
});

// --- ADMIN ROUTES ---

// Get all students
app.get('/api/admin/students', verifyAdmin, async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password');
    res.json(students);
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ message: 'Server database error.' });
  }
});

// Approve a student
app.put('/api/admin/students/:id/approve', verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const student = await User.findOneAndUpdate(
      { _id: id, role: 'student' },
      { status: 'approved' },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    res.json({ message: `Student '${student.name}' approved successfully.` });
  } catch (error) {
    console.error('Approve student error:', error);
    res.status(500).json({ message: 'Server database error.' });
  }
});

// Reject/Delete a student registration request
app.delete('/api/admin/students/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const student = await User.findOneAndDelete({ _id: id, role: 'student' });

    if (!student) {
      return res.status(404).json({ message: 'Student request not found.' });
    }

    res.json({ message: `Registration request for '${student.name}' has been rejected/deleted.` });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Server database error.' });
  }
});

// Default root route to check if API is alive
app.get('/', (req, res) => {
  res.json({ message: 'LMS Backend API is running successfully!' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Express auth server running on port ${PORT}`);
});

// Export app for Vercel serverless functions
module.exports = app;

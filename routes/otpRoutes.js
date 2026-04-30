import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Routes
import otpRoutes from './routes/otpRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import appRoutes from './routes/appRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ SUPABASE CLIENT ============
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Make supabase available in routes
app.locals.supabaseAdmin = supabaseAdmin;

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'StudyElite Backend is running 🚀',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

// ============ ROUTES ============
app.use('/api/otp', otpRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/admin', adminRoutes);

// ============ 404 Handler ============
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Email service: ${process.env.GMAIL_REFRESH_TOKEN ? 'Gmail API Ready' : 'Gmail API not configured'}`);
  console.log(`📱 SMS service: Ready`);
  console.log(`🗄️  Supabase: Connected`);
});

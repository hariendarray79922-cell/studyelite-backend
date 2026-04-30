import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const otpStore = new Map();
const rateLimit = new Map();

// 🔥 BREVO SMTP CONFIGURATION
let transporter = null;

function initTransporter() {
  if (!process.env.BREVO_EMAIL || !process.env.BREVO_SMTP_KEY) {
    console.log("⚠️ Brevo credentials missing. Email disabled.");
    return;
  }
  
  transporter = nodemailer.createTransport({
    host: "smtp-relay.sendinblue.com",
    port: 587,
    secure: false,  // TLS
    auth: {
      user: process.env.BREVO_EMAIL,
      pass: process.env.BREVO_SMTP_KEY
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });
  
  // Verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.log("❌ Brevo Error:", error.message);
    } else {
      console.log("✅ Brevo SMTP ready (Free: 300 emails/day, Paid: 1000+/day)");
    }
  });
}

initTransporter();

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) otpStore.delete(key);
  }
  for (const [key, value] of rateLimit.entries()) {
    if (now - value > 60 * 60 * 1000) rateLimit.delete(key);
  }
}, 5 * 60 * 1000);

function checkRateLimit(identifier) {
  const now = Date.now();
  const attempts = rateLimit.get(identifier) || [];
  const recent = attempts.filter(t => now - t < 60 * 1000);
  if (recent.length >= 3) return false;
  recent.push(now);
  rateLimit.set(identifier, recent);
  return true;
}

async function isUserBlocked(phone, email, supabaseAdmin) {
  if (!supabaseAdmin) return { blocked: false };
  try {
    if (phone) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked")
        .eq("phone", phone)
        .maybeSingle();
      if (data?.is_blocked === true) return { blocked: true };
    }
    if (email) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked")
        .eq("email", email)
        .maybeSingle();
      if (data?.is_blocked === true) return { blocked: true };
    }
  } catch (err) {
    console.error("Block check error:", err);
  }
  return { blocked: false };
}

router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  // Block check
  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ success: false, error: "Account blocked", blocked: true });
  }

  // Rate limit
  if (!resend && !checkRateLimit(identifier)) {
    return res.status(429).json({ success: false, error: "Too many attempts. Please wait 1 minute." });
  }

  // Generate OTP
  let otp;
  const existing = otpStore.get(identifier);
  
  if (resend && existing && (Date.now() - existing.timestamp < 5 * 60 * 1000)) {
    otp = existing.otp;
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(identifier, { otp, timestamp: Date.now() });
  }
  
  console.log("📱 OTP 👉", otp, "for:", identifier);

  let smsOk = false;
  let emailOk = false;

  // 📱 SMS attempt
  if (phone) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, message: `Your OTP is ${otp}` }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      smsOk = smsRes.ok;
      console.log("📲 SMS:", smsOk ? "✅ Sent" : "❌ Failed");
    } catch (err) {
      console.log("❌ SMS ERROR:", err.message);
    }
  }

  // 📧 EMAIL via Brevo (if SMS failed)
  if ((!smsOk || resend) && email && transporter) {
    try {
      console.log("📧 Sending email via Brevo...");
      
      const info = await transporter.sendMail({
        from: `"StudyElite" <${process.env.BREVO_EMAIL}>`,
        to: email,
        subject: "🔐 Your OTP Code - StudyElite",
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 16px; padding: 40px 20px; text-align: center;">
              <div style="background: white; border-radius: 12px; padding: 30px;">
                <h2 style="color: #4f46e5; margin-bottom: 20px;">🔐 StudyElite</h2>
                <h1 style="font-size: 48px; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${otp}</h1>
                <p style="color: #4b5563;">This OTP is valid for <strong>5 minutes</strong>.</p>
                <hr style="margin: 20px 0;">
                <p style="color: #6b7280; font-size: 12px;">StudyElite - Secure Learning Platform</p>
              </div>
            </div>
          </div>
        `,
        text: `Your OTP is ${otp}. Valid for 5 minutes. - StudyElite`
      });
      
      console.log("✅ EMAIL SENT via Brevo:", info.messageId);
      emailOk = true;
      
    } catch (err) {
      console.log("❌ EMAIL ERROR:", err.message);
    }
  }

  res.json({ 
    success: smsOk || emailOk, 
    sms: smsOk, 
    email: emailOk,
    message: (smsOk || emailOk) ? "OTP sent" : "Failed to send OTP"
  });
});

router.post("/verify-otp", async (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;
  const stored = otpStore.get(identifier);

  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ success: false, error: "Account blocked", blocked: true });
  }

  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true });
  }
  
  res.json({ success: false, error: "Invalid or expired OTP" });
});

export default router;

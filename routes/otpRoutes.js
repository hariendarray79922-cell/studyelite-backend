import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();
const otpStore = new Map();

// Clean up old OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// 🔥 FIXED TRANSPORTER with correct settings
let transporter = null;

function initTransporter() {
  if (!process.env.EMAIL || !process.env.PASS) {
    console.log("⚠️ Email credentials missing");
    return;
  }
  
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,  // SSL
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS  // Must be App Password (16 chars)
    },
    // Timeouts
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });
  
  // Verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.log("❌ Gmail Error:", error.message);
      console.log("💡 Solution: Use App Password instead of regular password");
    } else {
      console.log("✅ Gmail ready");
    }
  });
}

initTransporter();

router.post("/send-otp", async (req, res) => {
  const { email, phone } = req.body;

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const identifier = phone || email;

  otpStore.set(identifier, { otp, timestamp: Date.now() });
  console.log("📱 OTP 👉", otp, "for:", identifier);

  let smsOk = false, emailOk = false;

  // SMS attempt
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
      if (smsRes.ok) smsOk = true;
      console.log("📲 SMS:", smsOk ? "✅" : "❌");
    } catch (err) {
      console.log("❌ SMS ERROR:", err.message);
    }
  }

  // 🔥 FIXED EMAIL
  if (!smsOk && email && transporter) {
    try {
      console.log("📧 Sending email to:", email);
      
      const info = await transporter.sendMail({
        from: `"StudyElite" <${process.env.EMAIL}>`,
        to: email,
        subject: "🔐 Your OTP Code - StudyElite",
        html: `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
            <h2 style="color: #4f46e5;">StudyElite</h2>
            <h1 style="font-size: 42px; letter-spacing: 5px;">${otp}</h1>
            <p>This OTP is valid for <strong>5 minutes</strong>.</p>
          </div>
        `
      });
      
      console.log("✅ EMAIL SENT:", info.messageId);
      emailOk = true;
      
    } catch (err) {
      console.log("❌ EMAIL ERROR:", err.message);
      
      // Special error handling for Gmail
      if (err.message.includes("Invalid login") || err.message.includes("Username and Password not accepted")) {
        console.log("💡 FIX: Generate App Password from Google Account");
        console.log("   1. Enable 2FA on your Google Account");
        console.log("   2. Go to Security → App Passwords");
        console.log("   3. Generate 16-digit code and use as PASS");
      }
    }
  }

  res.json({ 
    success: smsOk || emailOk, 
    sms: smsOk, 
    email: emailOk,
    message: (smsOk || emailOk) ? "OTP sent" : "Failed to send OTP"
  });
});

router.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const stored = otpStore.get(identifier);

  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true });
  }
  res.json({ success: false, error: "Invalid OTP" });
});

export default router;

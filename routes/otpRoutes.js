import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();

const otpStore = new Map();
const rateLimit = new Map();

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

// 🔥 CHECK IF USER IS BLOCKED
async function isUserBlocked(phone, email, supabaseAdmin) {
  if (!supabaseAdmin) return false;
  
  try {
    // Check by phone
    if (phone) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked, blocked_reason")
        .eq("phone", phone)
        .maybeSingle();
      
      if (data && data.is_blocked === true) {
        return { blocked: true, reason: data.blocked_reason || "Account blocked by admin" };
      }
    }
    
    // Check by email
    if (email) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked, blocked_reason")
        .eq("email", email)
        .maybeSingle();
      
      if (data && data.is_blocked === true) {
        return { blocked: true, reason: data.blocked_reason || "Account blocked by admin" };
      }
    }
    
    return { blocked: false };
  } catch (err) {
    console.error("Block check error:", err);
    return { blocked: false };
  }
}

router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  // 🔥 CHECK IF USER IS BLOCKED
  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ 
      success: false, 
      error: blockCheck.reason,
      blocked: true 
    });
  }

  // Rate limit check (skip for resend? optional)
  if (!resend && !checkRateLimit(identifier)) {
    return res.status(429).json({ 
      success: false, 
      error: "Too many attempts. Please wait 1 minute." 
    });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore.set(identifier, { otp, timestamp: Date.now() });
  console.log("OTP 👉", otp, "for:", identifier);

  let smsOk = false, emailOk = false;

  // SMS attempt
  if (phone) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, message: `Your OTP is ${otp}` }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (smsRes.ok) smsOk = true;
    } catch (err) { console.log("SMS ERROR:", err.message); }
  }

  // Email fallback
  if (!smsOk && email) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL, pass: process.env.PASS }
      });
      await transporter.sendMail({
        from: `"StudyElite" <${process.env.EMAIL}>`,
        to: email,
        subject: "Your OTP Code",
        html: `<h1>${otp}</h1><p>This OTP is valid for 5 minutes.</p>`
      });
      emailOk = true;
    } catch (err) { console.log("MAIL ERROR:", err.message); }
  }

  res.json({ 
    success: smsOk || emailOk, 
    sms: smsOk, 
    email: emailOk,
    blocked: false
  });
});

router.post("/verify-otp", async (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;
  const stored = otpStore.get(identifier);

  // 🔥 CHECK BLOCK STATUS AGAIN
  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ 
      success: false, 
      error: blockCheck.reason,
      blocked: true 
    });
  }

  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true });
  }
  res.json({ success: false, error: "Invalid OTP" });
});

export default router;

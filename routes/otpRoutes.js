import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const otpStore = new Map();

// 🔥 BREVO API - FASTER than SMTP
async function sendEmailViaBrevo(to, otp) {
  const apiKey = process.env.BREVO_API_KEY;  // v3 API key, not SMTP key
  
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_EMAIL, name: "StudyElite" },
      to: [{ email: to }],
      subject: "🔐 Your OTP Code - StudyElite",
      htmlContent: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
          <h2 style="color: #4f46e5;">🔐 StudyElite</h2>
          <h1 style="font-size: 48px; letter-spacing: 8px; color: #2563eb;">${otp}</h1>
          <p>This OTP is valid for <strong>5 minutes</strong>.</p>
          <p style="color: #666; font-size: 12px;">StudyElite - Secure Learning Platform</p>
        </body>
        </html>
      `,
      textContent: `Your OTP is ${otp}. Valid for 5 minutes.`
    })
  });
  
  return response.ok;
}

router.post("/send-otp", async (req, res) => {
  const { email, phone } = req.body;
  const identifier = phone || email;
  
  if (!phone && !email) {
    return res.json({ success: false });
  }
  
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore.set(identifier, { otp, timestamp: Date.now() });
  console.log("📱 OTP 👉", otp, "for:", identifier);
  
  let smsOk = false;
  let emailOk = false;
  
  // SMS
  if (phone) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, message: `Your OTP is ${otp}` }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      smsOk = smsRes.ok;
    } catch (err) {
      console.log("SMS ERROR:", err.message);
    }
  }
  
  // 🔥 EMAIL via Brevo API (Fast!)
  if ((!smsOk) && email && process.env.BREVO_API_KEY) {
    try {
      const apiKey = process.env.BREVO_API_KEY;
      
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          sender: { email: process.env.BREVO_EMAIL, name: "StudyElite" },
          to: [{ email: email }],
          subject: "🔐 Your OTP Code - StudyElite",
          htmlContent: `<h1>${otp}</h1><p>Valid for 5 minutes.</p>`
        })
      });
      
      if (response.ok) {
        console.log("✅ Email sent via Brevo API");
        emailOk = true;
      } else {
        const error = await response.text();
        console.log("❌ Brevo API error:", error);
      }
    } catch (err) {
      console.log("❌ Email error:", err.message);
    }
  }
  
  res.json({ success: smsOk || emailOk, sms: smsOk, email: emailOk });
});

router.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const stored = otpStore.get(identifier);
  
  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true });
  }
  res.json({ success: false });
});

export default router;

import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();
const otpStore = new Map(); // Better than object

// Clean up old OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

router.post("/send-otp", async (req, res) => {
  const { email, phone } = req.body;

  if (!phone && !email) {
    return res.json({ success: false });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const identifier = phone || email;

  otpStore.set(identifier, { otp, timestamp: Date.now() });
  console.log("OTP 👉", otp);

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
      const smsData = await smsRes.json();
      if (smsRes.ok && smsData.success) smsOk = true;
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
        html: `<h1>${otp}</h1>`
      });
      emailOk = true;
    } catch (err) { console.log("MAIL ERROR:", err.message); }
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

import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();

const otpStore = new Map();

/* 🧹 CLEANUP */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/* 🔥 GMAIL SMTP CONFIG */
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // ❗ important
  auth: {
    user: process.env.EMAIL, // Gmail
    pass: process.env.PASS   // App Password
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 20000,
  greetingTimeout: 15000,
  socketTimeout: 20000
});

/* 🔍 VERIFY SMTP */
transporter.verify((err, success) => {
  if (err) {
    console.log("❌ SMTP ERROR 👉", err);
  } else {
    console.log("✅ SMTP READY");
  }
});

/* 🚀 SEND OTP */
router.post("/send-otp", async (req, res) => {
  const { phone, email } = req.body;

  console.log("📩 REQUEST 👉", { phone, email });

  if (!phone && !email) {
    return res.json({ success: false });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const key = phone || email;

  otpStore.set(key, { otp, timestamp: Date.now() });

  console.log("🔑 OTP 👉", otp);

  let smsOk = false;
  let emailOk = false;

  /* 📱 SMS TRY */
  if (phone) {
    try {
      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          message: `Your OTP is ${otp}`
        })
      });

      smsOk = smsRes.ok;
      console.log("📲 SMS STATUS 👉", smsOk);

    } catch (err) {
      console.log("❌ SMS ERROR 👉", err.message);
    }
  }

  /* 📧 EMAIL FALLBACK */
  if (!smsOk && email) {
    try {
      console.log("📧 Sending EMAIL OTP...");

      const info = await transporter.sendMail({
        from: `"StudyElite" <${process.env.EMAIL}>`,
        to: email,
        subject: "Your OTP Code",
        html: `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
      });

      console.log("✅ EMAIL SENT 👉", info.response);

      emailOk = true;

    } catch (err) {
      console.log("❌ MAIL ERROR 👉", err);
    }
  }

  res.json({
    success: smsOk || emailOk,
    sms: smsOk,
    email: emailOk
  });
});

/* ✅ VERIFY OTP */
router.post("/verify-otp", (req, res) => {
  const { phone, email, otp } = req.body;

  const key = phone || email;
  const stored = otpStore.get(key);

  if (stored && stored.otp === otp) {
    otpStore.delete(key);
    return res.json({ success: true });
  }

  res.json({ success: false });
});

export default router;

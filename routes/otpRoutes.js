import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import dns from "dns";

const router = express.Router();
const otpStore = new Map();

/* 🔥 FORCE IPv4 */
dns.setDefaultResultOrder("ipv4first");

/* 🧹 CLEANUP */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (now - v.timestamp > 5 * 60 * 1000) {
      otpStore.delete(k);
    }
  }
}, 5 * 60 * 1000);

/* 🔥 GMAIL SMTP (MAX FORCE CONFIG) */
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",

  port: 465,          // SSL
  secure: true,

  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS // 🔑 App Password
  },

  family: 4, // 🔥 IPv4 only

  connectionTimeout: 60000,
  greetingTimeout: 60000,
  socketTimeout: 60000,

  tls: {
    rejectUnauthorized: false
  }
});

/* 🔍 VERIFY */
transporter.verify((err) => {
  if (err) {
    console.log("❌ SMTP ERROR 👉", err);
  } else {
    console.log("✅ SMTP READY (GMAIL)");
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

  /* 📧 EMAIL FALLBACK (GMAIL) */
  if (!smsOk && email) {
    try {
      console.log("📧 Sending EMAIL OTP (GMAIL)...");

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

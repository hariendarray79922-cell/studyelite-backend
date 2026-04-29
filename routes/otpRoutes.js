import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();

const otpStore = new Map();
const rateLimit = new Map();

/* 🔄 CLEANUP */
setInterval(() => {
  const now = Date.now();

  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      otpStore.delete(key);
    }
  }

  for (const [key, value] of rateLimit.entries()) {
    if (now - value > 60 * 60 * 1000) {
      rateLimit.delete(key);
    }
  }
}, 5 * 60 * 1000);

/* 🚫 RATE LIMIT */
function checkRateLimit(identifier) {
  const now = Date.now();
  const attempts = rateLimit.get(identifier) || [];

  const recent = attempts.filter(t => now - t < 60 * 1000);
  if (recent.length >= 3) return false;

  recent.push(now);
  rateLimit.set(identifier, recent);
  return true;
}

/* ================= OTP SEND ================= */
router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;

  if (!phone && !email) return res.json({ success: false });

  if (!checkRateLimit(identifier)) {
    return res.status(429).json({ success: false, error: "Too many attempts" });
  }

  /* 🔢 OTP GENERATE */
  let otp;
  const existing = otpStore.get(identifier);

  if (resend && existing && (Date.now() - existing.timestamp) < 5 * 60 * 1000) {
    otp = existing.otp; // 🔁 same OTP
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(identifier, { otp, timestamp: Date.now() });
  }

  console.log("OTP 👉", otp);

  let smsOk = false;
  let emailOk = false;

  /* ================= SMS TRY (FAST 1.5s) ================= */
  if (phone && !resend) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500); // ⚡ fast

      const smsPromise = fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          message: `Your OTP is ${otp}`
        }),
        signal: controller.signal
      }).then(res => res.ok).catch(() => false);

      smsOk = await smsPromise;
      clearTimeout(timeout);

      console.log("SMS STATUS 👉", smsOk);

    } catch (err) {
      console.log("SMS ERROR ❌", err.message);
      smsOk = false;
    }
  }

  /* ================= EMAIL FALLBACK ================= */
  if ((resend || !smsOk) && email) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL,
          pass: process.env.PASS
        }
      });

      await transporter.sendMail({
        from: `"StudyElite" <${process.env.EMAIL}>`,
        to: email,
        subject: "Your OTP Code",
        html: `<h2>Your OTP is:</h2><h1>${otp}</h1>`
      });

      console.log("EMAIL SENT ✅");
      emailOk = true;

    } catch (err) {
      console.log("MAIL ERROR ❌");
      console.log("MESSAGE 👉", err.message);
      if (err.response) console.log("SMTP 👉", err.response);
    }
  }

  /* ================= RESPONSE ================= */
  res.json({
    success: smsOk || emailOk,
    sms: smsOk,
    email: emailOk
  });
});

/* ================= VERIFY ================= */
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

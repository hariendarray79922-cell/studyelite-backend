import express from "express";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const router = express.Router();

/* =========================
   STORE
========================= */
const otpStore = new Map();
const rateLimit = new Map();

/* =========================
   CLEANUP
========================= */
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

/* =========================
   RATE LIMIT
========================= */
function checkRateLimit(identifier) {
  const now = Date.now();
  const attempts = rateLimit.get(identifier) || [];

  const recent = attempts.filter(t => now - t < 60 * 1000);

  if (recent.length >= 3) return false;

  recent.push(now);
  rateLimit.set(identifier, recent);

  return true;
}

/* =========================
   EMAIL (BREVO)
========================= */
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: "hariendarray79922@gmail.com",
    pass: "xsmtpsib-8ff4cccdc910fe21f9f4f23092ca2668eea2da91196e9cd15147ff56d9eec520-hef6gjaezhH2rz3Q" // 🔥 यहाँ अपनी नई key डाल
  }
});

/* =========================
   SEND OTP
========================= */
router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;

  console.log("📩 REQUEST 👉", { phone, email, resend });

  if (!phone && !email) {
    return res.json({ success: false });
  }

  if (!checkRateLimit(identifier)) {
    return res.status(429).json({ success: false, error: "Too many attempts" });
  }

  /* OTP GENERATE / REUSE */
  let otp;
  const existing = otpStore.get(identifier);

  if (resend && existing && (Date.now() - existing.timestamp < 5 * 60 * 1000)) {
    otp = existing.otp;
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(identifier, { otp, timestamp: Date.now() });
  }

  console.log("🔑 OTP 👉", otp);

  let smsOk = false;
  let emailOk = false;

  /* =========================
     SMS TRY (TERMUX)
  ========================== */
  if (phone && !resend) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          message: `StudyElite OTP: ${otp} (valid 5 min)`
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      smsOk = smsRes.ok;

      console.log("📲 SMS STATUS 👉", smsOk);

    } catch (err) {
      console.log("❌ SMS ERROR 👉", err.message);
    }
  }

  /* =========================
     EMAIL (BREVO)
  ========================== */
  if ((resend || !smsOk) && email) {
    try {
      console.log("📧 Sending EMAIL OTP...");

      const info = await transporter.sendMail({
        from: `"StudyElite" <hariendarray79922@gmail.com>`,
        to: email,
        subject: "Your OTP Code",
        html: `
          <div style="font-family:sans-serif;text-align:center">
            <h2>StudyElite OTP</h2>
            <h1>${otp}</h1>
            <p>This OTP is valid for 5 minutes.</p>
          </div>
        `
      });

      console.log("✅ EMAIL SENT 👉", info.response);
      emailOk = true;

    } catch (err) {
      console.log("❌ MAIL ERROR 👉", err.message);
    }
  }

  /* RESPONSE */
  res.json({
    success: smsOk || emailOk,
    sms: smsOk,
    email: emailOk
  });
});

/* =========================
   VERIFY OTP
========================= */
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

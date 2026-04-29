import express from "express";
import fetch from "node-fetch";

const router = express.Router();
const otpStore = new Map();

/* 🧹 CLEANUP */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (now - v.timestamp > 5 * 60 * 1000) {
      otpStore.delete(k);
    }
  }
}, 5 * 60 * 1000);

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

  /* 📧 EMAIL FALLBACK (SUPABASE) */
  if (!smsOk && email) {
    try {
      console.log("📧 Sending via Supabase...");

      const supabase = req.app.locals.supabaseAdmin;

      const { error } = await supabase.auth.signInWithOtp({
        email
      });

      if (error) {
        console.log("❌ SUPABASE ERROR 👉", error.message);
      } else {
        console.log("✅ EMAIL SENT (SUPABASE)");
        emailOk = true;
      }

    } catch (err) {
      console.log("❌ EMAIL ERROR 👉", err.message);
    }
  }

  res.json({
    success: smsOk || emailOk,
    sms: smsOk,
    email: emailOk
  });
});

/* ✅ VERIFY OTP */
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const supabase = req.app.locals.supabaseAdmin;

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email"
    });

    if (error) {
      return res.json({ success: false });
    }

    res.json({ success: true });

  } catch (err) {
    res.json({ success: false });
  }
});

export default router;

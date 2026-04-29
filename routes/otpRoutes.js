import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/* 🚀 SEND OTP */
router.post("/send-otp", async (req, res) => {
  const { phone, email } = req.body;

  console.log("📩 REQUEST 👉", { phone, email });

  if (!phone && !email) {
    return res.json({ success: false, error: "No input" });
  }

  let smsOk = false;
  let method = "";

  /* =========================
     📱 SMS TRY
  ========================== */
  if (phone) {
    try {
      const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          message: `Your OTP is being sent...`
        })
      });

      smsOk = smsRes.ok;

      console.log("📲 SMS STATUS 👉", smsOk);

      if (smsOk) {
        method = "sms";
        return res.json({ success: true, method });
      }

    } catch (err) {
      console.log("❌ SMS ERROR 👉", err.message);
    }
  }

  /* =========================
     📧 EMAIL FALLBACK (SUPABASE)
  ========================== */
  if (email) {
    try {
      const supabase = req.app.locals.supabaseAdmin;

      const { error } = await supabase.auth.signInWithOtp({
        email
      });

      if (error) {
        console.log("❌ EMAIL ERROR 👉", error.message);
        return res.json({ success: false });
      }

      console.log("✅ EMAIL OTP SENT");
      method = "email";

      return res.json({ success: true, method });

    } catch (err) {
      console.log("❌ EMAIL ERROR 👉", err.message);
      return res.json({ success: false });
    }
  }

  res.json({ success: false });
});

/* 🔐 VERIFY OTP */
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
      console.log("❌ VERIFY ERROR 👉", error.message);
      return res.json({ success: false });
    }

    console.log("✅ VERIFIED");
    res.json({ success: true });

  } catch (err) {
    res.json({ success: false });
  }
});

export default router;

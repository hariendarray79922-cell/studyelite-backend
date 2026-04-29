import fetch from "node-fetch";

router.post("/send-otp", async (req, res) => {
  const { phone, email } = req.body;

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore.set(phone || email, { otp, timestamp: Date.now() });

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
      console.log("❌ SMS ERROR");
    }
  }

  /* 📧 EMAIL (SUPABASE FALLBACK STYLE) */
  if (!smsOk && email) {
    try {
      console.log("📧 Sending EMAIL via Supabase style...");

      await fetch("https://pouoldwsnvuabvelilhj.supabase.co/auth/v1/otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": "YOUR_ANON_KEY"
        },
        body: JSON.stringify({
          email: email,
          data: { otp } // optional
        })
      });

      emailOk = true;

    } catch (err) {
      console.log("❌ EMAIL ERROR");
    }
  }

  res.json({
    success: smsOk || emailOk,
    sms: smsOk,
    email: emailOk
  });
});

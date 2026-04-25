import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

import createSubscription from "./routes/createSubscription.js";
import createOrder from "./routes/createOrder.js";
import webhook from "./routes/webhook.js";
import { checkPendingSubscriptions } from "./utils/checkPendingSubs.js";

dotenv.config();

const app = express();
app.use(cors());

/* 🔐 Razorpay Webhook */
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhook
);

app.use(express.json());

/* ================= OTP SYSTEM ================= */

const otpStore = {};

/* 🔥 EMAIL + SMS OTP (FINAL) */
app.post("/send-otp", async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.json({ success: false });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  // store both
  otpStore[email] = otp;
  otpStore[phone] = otp;

  console.log("OTP 👉", otp);

  let emailOk = false;
  let smsOk = false;

  /* 📩 EMAIL */
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
      html: `<h1>${otp}</h1>`
    });

    emailOk = true;

  } catch (err) {
    console.log("MAIL ERROR:", err.message);
  }

  /* 📱 SMS (Termux via otp.shop) */
try {
  const smsRes = await fetch("https://sms.studyelite.shop/send-sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      number: phone,
      message: `Your OTP is ${otp}`
    })
  });

  const smsData = await smsRes.json();

  if (smsRes.ok && smsData.success) {
    smsOk = true;
    console.log("SMS SENT ✅");
  } else {
    console.log("SMS FAILED ❌", smsData);
  }

} catch (err) {
  console.log("SMS ERROR ❌", err.message);
}

  res.json({
    success: emailOk || smsOk,
    email: emailOk,
    sms: smsOk
  });
});

/* 🔥 VERIFY OTP (FIXED) */
app.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;

  if (
    otpStore[email] == otp ||
    otpStore[phone] == otp
  ) {
    delete otpStore[email];
    delete otpStore[phone];

    return res.json({ success: true });
  }

  res.json({ success: false });
});

/* ================= EXISTING ROUTES ================= */

app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

/* 🧪 Trial + Autopay */
app.use("/create-subscription", createSubscription);

/* 💳 Direct Payment */
app.use("/create-order", createOrder);

/* 🔁 Backup checker */
setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

/* ================= START ================= */

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

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

/* 🔥 HYBRID OTP (EMAIL + SMS) */
app.post("/send-otp-hybrid", async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.json({ success: false });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore[email] = otp;

  console.log("OTP 👉", otp);

  let emailStatus = false;
  let smsStatus = false;

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
      html: `
        <h2>Your OTP Code</h2>
        <h1 style="letter-spacing:5px;">${otp}</h1>
      `
    });

    emailStatus = true;

  } catch (err) {
    console.log("MAIL ERROR:", err.message);
  }

  /* 📱 SMS (Termux) */
  try {
    await fetch("https://sms.studyelite.shop/send-sms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        number: phone,
        message: `Your OTP is ${otp}`
      })
    });

    smsStatus = true;

  } catch (err) {
    console.log("SMS ERROR:", err.message);
  }

  res.json({
    success: emailStatus || smsStatus,
    email: emailStatus,
    sms: smsStatus
  });
});

/* VERIFY OTP */
app.post("/verify-email-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore[email] == otp) {
    delete otpStore[email];
    return res.json({ success: true });
  }

  res.json({ success: false });
});

/* ================= EXISTING ROUTES ================= */

app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

app.use("/create-subscription", createSubscription);
app.use("/create-order", createOrder);

setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

/* ================= START ================= */

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

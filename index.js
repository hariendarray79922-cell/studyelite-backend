import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

import createSubscription from "./routes/createSubscription.js";
import createOrder from "./routes/createOrder.js";
import webhook from "./routes/webhook.js";
import { checkPendingSubscriptions } from "./utils/checkPendingSubs.js";
import cancelSubscription from "./routes/cancelSubscription.js";

dotenv.config();

const app = express();
app.use(cors());

// Supabase Admin (Service Role Key - Bypasses RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Make available to routes
app.locals.supabaseAdmin = supabaseAdmin;

/* 🔐 Razorpay Webhook */
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhook
);

app.use(express.json());

/* ================= OTP SYSTEM ================= */
const otpStore = {};

app.post("/send-otp", async (req, res) => {
  const { email, phone } = req.body;
  if (!phone && !email) return res.json({ success: false });

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  if (email) otpStore[email] = otp;
  if (phone) otpStore[phone] = otp;
  console.log("OTP 👉", otp);

  let smsOk = false, emailOk = false;

  // SMS
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

  // Email Fallback
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

app.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;
  if ((email && otpStore[email] == otp) || (phone && otpStore[phone] == otp)) {
    if (email) delete otpStore[email];
    if (phone) delete otpStore[phone];
    return res.json({ success: true });
  }
  res.json({ success: false });
});

/* ================= ROUTES ================= */
app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

app.use("/create-subscription", createSubscription);
app.use("/create-order", createOrder);
app.use("/create-order/verify", createOrder);
app.use("/cancel-subscription", cancelSubscription);

/* 🔁 Backup checker for pending subscriptions */
setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

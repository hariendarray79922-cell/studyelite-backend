import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

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

/* ================= OTP SYSTEM (ADDED) ================= */

const otpStore = {};

/* SEND EMAIL OTP */
app.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.json({ success: false });

  const otp = Math.floor(1000 + Math.random() * 9000);
  otpStore[email] = otp;

  console.log("OTP 👉", otp);

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
        <p>Use this code to login:</p>
        <h1 style="letter-spacing:5px;">${otp}</h1>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.log("MAIL ERROR:", err.message);
    res.json({ success: false });
  }
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

/* 🧪 Trial + Autopay */
app.use("/create-subscription", createSubscription);

/* 💳 Direct Payment (1 Year) */
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

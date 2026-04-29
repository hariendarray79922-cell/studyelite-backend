import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import createSubscription from "./routes/createSubscription.js";
import createOrder from "./routes/createOrder.js";
import webhook from "./routes/webhook.js";
import { checkPendingSubscriptions } from "./utils/checkPendingSubs.js";
import cancelSubscription from "./routes/cancelSubscription.js";
import otpRoutes from "./routes/otpRoutes.js";

dotenv.config();

const app = express();
app.use(cors());

// 🔥 Supabase Admin
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.locals.supabaseAdmin = supabaseAdmin;

// Webhook (raw body)
app.use("/webhook", express.raw({ type: "application/json" }), webhook);

// JSON parser
app.use(express.json());

// ✅ OTP ROUTES FIX
app.use("/api", otpRoutes);

// ✅ PAYMENT ROUTES
app.use("/create-order", createOrder);
app.use("/create-subscription", createSubscription);
app.use("/cancel-subscription", cancelSubscription);

// ✅ HEALTH CHECK
app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

// ✅ BACKGROUND CHECK
setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

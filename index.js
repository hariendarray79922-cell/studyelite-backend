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

// Supabase Admin
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.locals.supabaseAdmin = supabaseAdmin;

// 🔥 FIX: Webhook MUST be before express.json()
app.use("/webhook", express.raw({ type: "application/json" }), webhook);

// JSON parser for other routes
app.use(express.json());

// Routes
app.use("/api", otpRoutes);
app.use("/create-order", createOrder);
app.use("/create-subscription", createSubscription);
app.use("/cancel-subscription", cancelSubscription);

// Health check
app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

// Background checker
setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

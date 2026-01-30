import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

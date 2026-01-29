import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import createSubscription from "./routes/createSubscription.js";
import webhook from "./routes/webhook.js";

dotenv.config();

const app = express();

/* ✅ CORS */
app.use(cors());

/* 🔥 IMPORTANT
   Razorpay webhook MUST use RAW body
   and MUST come BEFORE express.json()
*/
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhook
);

/* ✅ Normal APIs use JSON */
app.use(express.json());

/* ✅ Health check */
app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

/* ✅ Create subscription */
app.use("/create-subscription", createSubscription);

/* ✅ Start server */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

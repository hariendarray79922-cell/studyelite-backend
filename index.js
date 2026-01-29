import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import createSubscription from "./routes/createSubscription.js";
import webhook from "./routes/webhook.js";
import { checkPendingSubscriptions } from "./utils/checkPendingSubs.js";

dotenv.config();

const app = express();
app.use(cors());

app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhook
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

app.use("/create-subscription", createSubscription);

setInterval(() => {
  checkPendingSubscriptions();
}, 60 * 1000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

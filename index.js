import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import createSubscription from "./routes/createSubscription.js";
import webhook from "./routes/webhook.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("StudyElite Backend Running 🚀");
});

app.use("/create-subscription", createSubscription);
app.use("/webhook", webhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

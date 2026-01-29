import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

router.post("/", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // 🔥 RAW BODY
      .digest("hex");

    if (signature !== expected) {
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const event = payload.event;

    if (event === "invoice.paid") {
      const subId =
        payload.payload.invoice.entity.subscription_id;

      await supabase
        .from("subscriptions")
        .update({ status: "active" })
        .eq("razorpay_subscription_id", subId);
    }

    if (event === "invoice.payment_failed") {
      const subId =
        payload.payload.invoice.entity.subscription_id;

      await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("razorpay_subscription_id", subId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Webhook error");
  }
});

export default router;

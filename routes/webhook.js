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
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const event = payload.event;

    console.log("Webhook:", event);

    /* ✅ SUBSCRIPTION ACTIVATED → ACCESS ON */
    if (event === "subscription.activated") {
      const sub = payload.payload.subscription.entity;

      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          start_date: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id);
    }

    /* ✅ PAYMENT CAPTURED → SAVE PAYMENT ID */
    if (event === "payment.captured") {
      const pay = payload.payload.payment.entity;

      await supabase
        .from("subscriptions")
        .update({
          razorpay_payment_id: pay.id
        })
        .eq("razorpay_subscription_id", pay.subscription_id);
    }

    /* 🔄 AUTO-DEBIT ATTEMPT */
    if (event === "subscription.charged") {
      const sub = payload.payload.subscription.entity;

      if (sub.status === "active") {
        await supabase
          .from("subscriptions")
          .update({ status: "active" })
          .eq("razorpay_subscription_id", sub.id);
      }

      if (sub.status === "halted") {
        // 👇 24 HOURS GRACE START
        await supabase
          .from("subscriptions")
          .update({
            status: "grace",
            grace_started_at: new Date().toISOString()
          })
          .eq("razorpay_subscription_id", sub.id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Webhook error");
  }
});

export default router;

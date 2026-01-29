import express from "express";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

router.post("/", async (req, res) => {
  const { subscription_id, user_id, app_id } = req.body;

  try {
    const sub = await razorpay.subscriptions.fetch(subscription_id);

    if (sub.status === "active") {
      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          start_date: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", subscription_id)
        .eq("user_id", user_id)
        .eq("app_id", app_id);

      return res.json({ success: true });
    }

    return res.json({ success: false });
  } catch (e) {
    return res.status(500).json({ error: "Verify failed" });
  }
});

export default router;

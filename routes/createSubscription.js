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
  try {
    const { app_id, user_id } = req.body;

    if (!app_id || !user_id) {
      return res.status(400).json({ error: "Missing app_id or user_id" });
    }

    const { data: app, error } = await supabase
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + app.trial_days * 86400
    });

    await supabase.from("subscriptions").insert({
      user_id,
      app_id,
      status: "trial",
      amount: app.price,
      razorpay_subscription_id: subscription.id
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
import express from "express";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    const { data: app, error } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check existing
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    const trialDays = app.trial_days || 1;
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + trialDays * 86400
    });

    // Save as pending
    const { data: newSub } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id,
        app_id,
        status: "pending",
        amount: app.price,
        razorpay_subscription_id: subscription.id,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id
    });

  } catch (err) {
    console.error("Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // Get app details
    const { data: app, error } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check if already has active subscription
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

    // 🔥 TRIAL AMOUNT = ₹2 (200 paise)
    const TRIAL_AMOUNT = 2;
    const trialDays = app.trial_days || 1;

    // Create Razorpay Subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + trialDays * 86400,
      addons: [
        {
          item: {
            name: `${app.app_name} - Trial`,
            amount: TRIAL_AMOUNT * 100,
            currency: "INR"
          }
        }
      ]
    });

    // 🔥 UPSERT - Single row per app (no duplicate)
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingSub) {
      // Update existing
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          updated_at: new Date()
        })
        .eq("id", existingSub.id);
    } else {
      // Insert new
      await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id,
          app_id,
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          created_at: new Date(),
          updated_at: new Date()
        });
    }

    console.log(`✅ Trial created for user: ${user_id}, app: ${app.app_name}`);

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT
    });

  } catch (err) {
    console.error("Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

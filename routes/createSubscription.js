import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

let supabaseAdmin = null;

router.use((req, res, next) => {
  supabaseAdmin = req.app.locals.supabaseAdmin;
  next();
});

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    if (!app_id || !user_id) {
      return res.status(400).json({ error: "Missing app_id or user_id" });
    }

    const { data: app, error } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // 🔥 CHECK IF SUBSCRIPTION ALREADY EXISTS
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    let subscriptionId;

    if (existingSub && existingSub.razorpay_subscription_id) {
      // Use existing subscription ID
      subscriptionId = existingSub.razorpay_subscription_id;
      console.log("✅ Using existing subscription:", subscriptionId);
    } else {
      // Create new Razorpay subscription
      const subscription = await razorpay.subscriptions.create({
        plan_id: app.razorpay_plan_id,
        customer_notify: 1,
        total_count: 12,
        start_at: Math.floor(Date.now() / 1000) + (app.trial_days || 7) * 86400
      });
      subscriptionId = subscription.id;

      // 🔥 UPSERT - Insert only if not exists
      if (existingSub) {
        // Update existing with subscription_id
        await supabaseAdmin
          .from("subscriptions")
          .update({
            razorpay_subscription_id: subscriptionId,
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
            amount: app.price,
            razorpay_subscription_id: subscriptionId,
            created_at: new Date(),
            updated_at: new Date()
          });
      }
    }

    return res.json({
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscriptionId
    });

  } catch (err) {
    console.error("Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

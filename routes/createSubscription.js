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

    console.log("📥 Request received:", { app_id, user_id });

    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    console.log("✅ App found:", app.app_name);

    const { data: activeSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (activeSub) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    const TRIAL_AMOUNT = 2;
    const trialDays = app.trial_days || 7;

    // 🔥 Start at TOMORROW (24 hours from now) - avoids "same day" display issue
    const startAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 1,
      start_at: startAt,
      addons: [
        {
          item: {
            name: `${app.app_name} - ${trialDays} Days Trial`,
            amount: TRIAL_AMOUNT * 100,
            currency: "INR"
          }
        }
      ]
    });

    console.log("✅ Razorpay subscription created:", subscription.id);
    
    // 🔥 REAL TIME - Current timestamp with milliseconds
    const currentTimestamp = new Date().toISOString();
    const subscriptionStartTimestamp = new Date(startAt * 1000).toISOString();
    
    console.log(`📅 Current Time (UTC): ${currentTimestamp}`);
    console.log(`📅 Subscription Start (UTC): ${subscriptionStartTimestamp}`);

    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    let dbResult;
    if (existingRow) {
      console.log("📝 Updating existing row:", existingRow.id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          razorpay_subscription_start_at: subscriptionStartTimestamp,
          updated_at: currentTimestamp
        })
        .eq("id", existingRow.id);
    } else {
      console.log("🆕 Inserting new row for user:", user_id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          razorpay_subscription_start_at: subscriptionStartTimestamp,
          created_at: currentTimestamp,
          updated_at: currentTimestamp
        });
    }

    if (dbResult.error) {
      console.error("❌ Database error:", dbResult.error);
      return res.status(500).json({ error: "Database insert failed", details: dbResult.error });
    }

    console.log("✅ Database row created/updated");

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays,
      start_at: startAt
    });

  } catch (err) {
    console.error("🔥 Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

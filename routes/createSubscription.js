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
    const FULL_PRICE = app.price || 1499;

    // 🔥 FIX 1: total_count = 999 (unlimited)
    // 🔥 FIX 2: NO start_at (let Razorpay handle)
    // 🔥 FIX 3: NO addons (clean trial)
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 999,      // ✅ Unlimited until cancelled
      // NO start_at - Razorpay handles immediately
      // NO addons - clean subscription
    });

    console.log("✅ Razorpay subscription created:", subscription.id);

    const currentTimestamp = new Date().toISOString();

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
      full_price: FULL_PRICE
    });

  } catch (err) {
    console.error("🔥 Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

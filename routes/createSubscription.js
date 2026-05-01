import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔥 TRIAL SUBSCRIPTION - ₹2 initial, then auto-debit after trial
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Trial subscription request:", { app_id, user_id });

    // Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check existing subscription
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (existingSub) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    const TRIAL_AMOUNT = 2;
    const trialDays = app.trial_days || 7;
    const fullAmount = app.price || 499;

    // Create subscription with trial add-on
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 12, // 12 months
      start_at: Math.floor(Date.now() / 1000) + (trialDays * 86400),
      addons: [
        {
          item: {
            name: `${app.app_name} - ${trialDays} Day Trial`,
            amount: TRIAL_AMOUNT * 100,
            currency: "INR"
          }
        }
      ],
      notes: {
        type: "trial",
        app_id: app_id,
        user_id: user_id,
        trial_days: trialDays,
        full_amount: fullAmount
      }
    });

    console.log("✅ Trial subscription created:", subscription.id);

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);

    // Save to database
    const { error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: user_id,
        app_id: app_id,
        status: "trial",
        amount: TRIAL_AMOUNT,
        razorpay_subscription_id: subscription.id,
        end_date: trialEndDate.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return res.status(500).json({ error: "Failed to save subscription" });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays,
      full_amount: fullAmount,
      is_recurring: true,
      message: `Trial activated for ${trialDays} days. After trial, ₹${fullAmount}/month will be auto-debited.`
    });

  } catch (err) {
    console.error("🔥 Trial subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

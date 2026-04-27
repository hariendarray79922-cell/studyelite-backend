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

    // 1. Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // 2. Check if already has ACTIVE or TRIAL subscription
    const { data: activeSub, error: checkError } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (activeSub) {
      return res.status(400).json({ 
        error: "You already have an active subscription for this app",
        status: activeSub.status,
        end_date: activeSub.end_date
      });
    }

    const TRIAL_AMOUNT = 2; // ₹2
    const trialDays = app.trial_days || 7;

    // 3. Create Razorpay subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 1,  // Only 1 payment for trial
      start_at: Math.floor(Date.now() / 1000),
      addons: [
        {
          item: {
            name: `${app.app_name} - ${trialDays} Days Trial`,
            amount: TRIAL_AMOUNT * 100,
            currency: "INR",
            description: `${trialDays} days trial access with ₹${TRIAL_AMOUNT} verification`
          }
        }
      ]
    });

    // 4. UPSERT - Single row per user+app (CREATE or UPDATE)
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    let subscriptionRecord;
    
    if (existingRow) {
      // UPDATE existing row with new pending attempt
      const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          razorpay_order_id: null,
          razorpay_payment_id: null,
          start_date: null,
          end_date: null,
          updated_at: new Date()
        })
        .eq("id", existingRow.id)
        .select();
      
      if (error) throw error;
      subscriptionRecord = data?.[0];
      console.log(`📝 Updated existing subscription: ${existingRow.id}`);
    } else {
      // CREATE new row
      const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          created_at: new Date(),
          updated_at: new Date()
        })
        .select();
      
      if (error) throw error;
      subscriptionRecord = data?.[0];
      console.log(`🆕 Created new subscription: ${subscriptionRecord.id}`);
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays,
      description: `${trialDays} days trial for ${app.app_name}`
    });

  } catch (err) {
    console.error("Create subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

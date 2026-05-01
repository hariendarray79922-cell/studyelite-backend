import express from "express";

const router = express.Router();

// 🔥 TRIAL SUBSCRIPTION - Create pending_trial first
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const Razorpay = await import("razorpay");
    
    const razorpay = new Razorpay.default({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    console.log("📥 Trial request:", { app_id, user_id });

    // Validation
    if (!app_id || !user_id) {
      return res.status(400).json({ error: "app_id and user_id are required" });
    }

    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      console.error("App not found:", appError);
      return res.status(404).json({ error: "App not found" });
    }

    const TRIAL_AMOUNT = 2;
    const trialDays = app.trial_days || 30;
    const fullAmount = app.price || 499;
    const planId = app.razorpay_plan_id;

    if (!planId) {
      return res.status(400).json({ error: "Razorpay plan not configured" });
    }

    // Check existing subscription
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow && (existingRow.status === "active" || existingRow.status === "trial")) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    // 🔥 FIX: receipt length must be <= 40 characters for notes
    const shortUserId = user_id.split('-')[0];
    const timestamp = Date.now().toString().slice(-8);
    const receiptNote = `trial_${shortUserId}_${timestamp}`.slice(0, 40);

    // Create subscription in Razorpay
    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 999,
      quantity: 1,
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
        full_amount: fullAmount,
        receipt: receiptNote
      }
    });

    console.log("✅ Trial subscription created:", subscription.id);

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);
    const subscriptionStartAt = new Date(subscription.start_at * 1000).toISOString();

    // UPSERT - Set status to pending_trial
    if (existingRow) {
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending_trial",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          end_date: trialEndDate.toISOString(),
          updated_at: new Date().toISOString(),
          razorpay_subscription_start_at: subscriptionStartAt,
          razorpay_payment_id: null,
          razorpay_order_id: null
        })
        .eq("id", existingRow.id);

      if (updateError) {
        console.error("DB update error:", updateError);
        return res.status(500).json({ error: "Failed to update subscription" });
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending_trial",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          end_date: trialEndDate.toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          razorpay_subscription_start_at: subscriptionStartAt
        });

      if (insertError) {
        console.error("DB insert error:", insertError);
        return res.status(500).json({ error: "Failed to save subscription" });
      }
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays,
      full_amount: fullAmount,
      is_recurring: true,
      status: "pending_trial"
    });

  } catch (err) {
    console.error("🔥 Trial error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 VERIFY TRIAL PAYMENT - Update status to "trial"
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const crypto = await import("crypto");

    console.log("📥 Verify trial:", { razorpay_subscription_id, razorpay_payment_id, user_id, app_id });

    const sign = crypto.default
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_subscription_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Update status to "trial"
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial",
        razorpay_payment_id: razorpay_payment_id,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .eq("razorpay_subscription_id", razorpay_subscription_id);

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to verify subscription" });
    }

    console.log(`✅ TRIAL ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true, status: "trial" });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

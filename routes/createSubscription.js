import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔥 TRIAL - Create ONE-TIME ORDER (₹2 only)
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Trial request:", { app_id, user_id });

    // Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check existing active subscription
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

    const TRIAL_AMOUNT = 2;  // ₹2 only
    const trialDays = app.trial_days || 7;

    // ✅ FIX: Create ONE-TIME ORDER (NOT subscription)
    const order = await razorpay.orders.create({
      amount: TRIAL_AMOUNT * 100,  // 200 paise = ₹2
      currency: "INR",
      receipt: `trial_${user_id}_${Date.now()}`,
      notes: {
        type: "trial",
        app_id: app_id,
        user_id: user_id,
        trial_days: trialDays
      }
    });

    console.log("✅ Trial order created:", order.id);
    console.log(`💰 Amount: ₹${TRIAL_AMOUNT} (Verification only)`);

    const currentTimestamp = new Date().toISOString();

    // Database operation
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow) {
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial_pending",
          amount: TRIAL_AMOUNT,
          razorpay_order_id: order.id,
          updated_at: currentTimestamp
        })
        .eq("id", existingRow.id);
    } else {
      await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "trial_pending",
          amount: TRIAL_AMOUNT,
          razorpay_order_id: order.id,
          created_at: currentTimestamp,
          updated_at: currentTimestamp
        });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays
    });

  } catch (err) {
    console.error("🔥 Trial order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIX: VERIFY TRIAL PAYMENT (yeh route missing tha)
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("🔐 Verifying trial payment:", { razorpay_order_id, razorpay_payment_id });

    // Verify signature
    const crypto = await import("crypto");
    const sign = crypto.default
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Get app details
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("trial_days")
      .eq("id", app_id)
      .single();

    const trialDays = app?.trial_days || 7;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + trialDays);

    // Update subscription
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id);

    console.log(`✅ TRIAL ACTIVATED: ${razorpay_payment_id}`);
    console.log(`📅 Start: ${start.toISOString()}`);
    console.log(`📅 End: ${end.toISOString()}`);
    
    res.json({ success: true });

  } catch (err) {
    console.error("Verify trial error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

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

    console.log("📥 Trial request:", { app_id, user_id });

    if (!supabaseAdmin) {
      console.error("❌ Supabase admin not initialized");
      return res.status(500).json({ error: "Database connection error" });
    }

    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      console.error("❌ App not found:", app_id);
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

    // 🔥 FIX: receipt ko chhoto karo (max 40 chars)
    const shortUserId = user_id.split('-')[0]; // "f105e1a1"
    const timestamp = Date.now().toString().slice(-8); // last 8 digits
    const receipt = `trial_${shortUserId}_${timestamp}`; // ~25 chars

    console.log("📝 Receipt:", receipt);

    const order = await razorpay.orders.create({
      amount: TRIAL_AMOUNT * 100,
      currency: "INR",
      receipt: receipt,  // ✅ Ab 40 chars se kam hai
      notes: {
        type: "trial",
        app_id: app_id,
        user_id: user_id,
        trial_days: trialDays
      }
    });

    console.log("✅ Trial order created:", order.id);

    const currentTimestamp = new Date().toISOString();

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

// Verify trial payment
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    const crypto = await import("crypto");
    const sign = crypto.default
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("trial_days")
      .eq("id", app_id)
      .single();

    const trialDays = app?.trial_days || 7;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + trialDays);

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
    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

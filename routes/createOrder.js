import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔥 PREMIUM ORDER - One-time payment, no auto-debit
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Premium order request:", { app_id, user_id });

    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    const fullPrice = app.price || 499;

    // Create one-time order
    const order = await razorpay.orders.create({
      amount: fullPrice * 100,
      currency: "INR",
      receipt: `premium_${user_id}_${Date.now()}`,
      notes: {
        type: "premium",
        app_id: app_id,
        user_id: user_id,
        is_recurring: false
      }
    });

    console.log("✅ Premium order created:", order.id);

    // Save to database
    const { error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: user_id,
        app_id: app_id,
        status: "pending",
        amount: fullPrice,
        razorpay_order_id: order.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return res.status(500).json({ error: "Failed to save order" });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: fullPrice,
      is_recurring: false,
      message: "One-time payment of ₹" + fullPrice + " for 1 year access. No auto-debit."
    });

  } catch (err) {
    console.error("🔥 Premium order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Verify premium payment
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    // Update subscription to active
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id);

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to update subscription" });
    }

    console.log(`✅ PREMIUM ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true, message: "Premium access activated for 1 year!" });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

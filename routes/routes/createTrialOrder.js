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

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (!app) return res.status(404).json({ error: "App not found" });

    const trialAmount = 2;  // ₹2 fixed
    const trialDays = app.trial_days || 7;

    // 🔥 CREATE ORDER (NOT SUBSCRIPTION) - One time ₹2
    const order = await razorpay.orders.create({
      amount: trialAmount * 100,
      currency: "INR",
      receipt: `trial_${user_id}_${Date.now()}`,
      notes: { type: "trial", app_id, user_id, trial_days: trialDays }
    });

    // Save to database
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial_pending",
          amount: trialAmount,
          razorpay_order_id: order.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "trial_pending",
          amount: trialAmount,
          razorpay_order_id: order.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: trialAmount,
      trial_days: trialDays
    });

  } catch (err) {
    console.error("Trial order error:", err);
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

    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

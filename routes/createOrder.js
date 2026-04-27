import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* 🧾 CREATE ORDER */
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    // Get app details
    const { data: app, error } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check if already has active subscription
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `order_${Date.now()}`
    });

    // Save order in DB with pending_direct status
    const { data: newSub, error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id,
        app_id,
        status: "pending_direct",
        amount: app.price,
        razorpay_order_id: order.id,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: "Failed to create order record" });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount,
      subscription_id: newSub.id
    });

  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ✅ VERIFY PAYMENT - BACKEND ONLY DB INSERT */
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;

    // 🔐 Verify signature (CRITICAL)
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      console.error("❌ Invalid signature!");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    // 🔥 UPDATE subscription to ACTIVE (ONLY BACKEND DOES THIS)
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        updated_at: new Date()
      })
      .eq("razorpay_order_id", razorpay_order_id)
      .select()
      .single();

    if (error) {
      console.error("DB update failed:", error);
      return res.status(500).json({ error: "DB update failed" });
    }

    console.log("✅ PAYMENT VERIFIED & ACTIVATED:", razorpay_payment_id);
    res.json({ success: true, subscription: data });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* 🧪 TRIAL SUBSCRIPTION VERIFY */
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;

    // Verify signature
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_subscription_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 7);

    // 🔥 UPDATE subscription to TRIAL
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial",
        razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        updated_at: new Date()
      })
      .eq("razorpay_subscription_id", razorpay_subscription_id)
      .select()
      .single();

    if (error) {
      console.error("DB update failed:", error);
      return res.status(500).json({ error: "DB update failed" });
    }

    console.log("✅ TRIAL ACTIVATED:", razorpay_payment_id);
    res.json({ success: true, subscription: data });

  } catch (err) {
    console.error("Verify subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

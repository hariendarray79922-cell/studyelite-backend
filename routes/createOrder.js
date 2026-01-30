import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* 🧾 CREATE ORDER */
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    const { data: app, error } = await supabase
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(400).json({ error: "App not found" });
    }

    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `order_${Date.now()}`
    });

    // ✅ VERY IMPORTANT: order_id save ho raha hai
    await supabase.from("subscriptions").insert({
      user_id,
      app_id,
      status: "pending_direct",
      amount: app.price,
      razorpay_order_id: order.id
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount
    });

  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Order create failed" });
  }
});

/* ✅ VERIFY PAYMENT */
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    // 🔐 Signature verify
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // 📅 Date fix (Supabase DATE type)
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    const { data, error } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10)
      })
      .eq("razorpay_order_id", razorpay_order_id)
      .select();

    // 🚨 MOST IMPORTANT LOG
    if (error) {
      console.error("❌ DB UPDATE FAILED:", error);
      return res.status(500).json({ error: "DB update failed" });
    }

    if (!data || data.length === 0) {
      console.error("⚠️ NO ROW MATCHED ORDER ID:", razorpay_order_id);
    }

    console.log("✅ DIRECT PAYMENT ACTIVE:", razorpay_payment_id);

    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Verify failed" });
  }
});

export default router;

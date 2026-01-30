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

    const { data: app } = await supabase
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`
    });

    await supabase.from("subscriptions").insert({
      user_id,
      app_id,
      status: "pending",
      amount: app.price,
      razorpay_order_id: order.id
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount
    });

  } catch (err) {
    console.error(err);
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

    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    await supabase
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id,
        start_date: new Date().toISOString(),
        end_date: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000
        ).toISOString()
      })
      .eq("razorpay_order_id", razorpay_order_id);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;

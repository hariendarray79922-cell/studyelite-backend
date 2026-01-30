import express from "express";
import Razorpay from "razorpay";
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

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    const { data: app } = await supabase
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    const order = await razorpay.orders.create({
      amount: app.price * 100, // ₹ → paise
      currency: "INR",
      receipt: `rcpt_${Date.now()}`
    });

    // 🔥 INSERT AS PENDING
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
    res.status(500).json({ error: "Order create failed" });
  }
});

export default router;

import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Get Supabase admin from app.locals
let supabaseAdmin = null;

router.use((req, res, next) => {
  supabaseAdmin = req.app.locals.supabaseAdmin;
  if (!supabaseAdmin) {
    console.error("❌ supabaseAdmin not initialized!");
  }
  next();
});

/* 🧾 CREATE ORDER */
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;

    const { data: app, error } = await supabaseAdmin
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

    // Insert pending subscription
    await supabaseAdmin.from("subscriptions").insert({
      user_id,
      app_id,
      status: "pending_direct",
      amount: app.price,
      razorpay_order_id: order.id,
      created_at: new Date()
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount
    });

  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ✅ VERIFY PAYMENT */
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Update subscription to active
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        updated_at: new Date()
      })
      .eq("razorpay_order_id", razorpay_order_id);

    if (error) {
      console.error("DB update failed:", error);
      return res.status(500).json({ error: "DB update failed" });
    }

    console.log("✅ DIRECT PAYMENT ACTIVE:", razorpay_payment_id);
    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper to validate user
async function validateUser(supabaseAdmin, user_id) {
  if (!user_id) return false;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", user_id)
    .maybeSingle();
  return !!data;
}

/* 🧾 CREATE ORDER */
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 🔥 AUTH CHECK
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: app, error } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Check existing active subscription
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

    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `order_${Date.now()}`
    });

    // Prevent duplicate
    const { data: existingOrder } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("razorpay_order_id", order.id)
      .maybeSingle();

    if (!existingOrder) {
      await supabaseAdmin.from("subscriptions").insert({
        user_id,
        app_id,
        status: "pending_direct",
        amount: app.price,
        razorpay_order_id: order.id,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    console.log(`✅ Order created for user: ${user_id}, app: ${app.app_name}`);

    res.json({
      success: true,
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 🔥 AUTH CHECK
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Duplicate payment check
    const { data: existingPayment } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("razorpay_payment_id", razorpay_payment_id)
      .maybeSingle();

    if (existingPayment && existingPayment.status === "active") {
      console.log("✅ Payment already processed:", razorpay_payment_id);
      return res.json({ success: true, already_processed: true });
    }

    // Verify signature
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

    console.log(`✅ PAYMENT VERIFIED: ${razorpay_payment_id} for user: ${user_id}`);
    res.json({ success: true, subscription: data });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* 🔥 FIXED: TRIAL VERIFY - CORRECT ROUTE */
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Duplicate check
    const { data: existingPayment } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("razorpay_payment_id", razorpay_payment_id)
      .maybeSingle();

    if (existingPayment && existingPayment.status === "trial") {
      return res.json({ success: true, already_processed: true });
    }

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

    console.log(`✅ TRIAL ACTIVATED: ${razorpay_payment_id} for user: ${user_id}`);
    res.json({ success: true, subscription: data });

  } catch (err) {
    console.error("Verify subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

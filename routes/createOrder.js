import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Direct order request:", { app_id, user_id });

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

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `direct_${Date.now()}`
    });

    console.log("✅ Razorpay order created:", order.id);

    // 🔥 FIX: Remove updated_at column
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    let dbResult;
    if (existingRow) {
      console.log("📝 Updating existing row:", existingRow.id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending_direct",
          amount: app.price,
          razorpay_order_id: order.id
          // ❌ REMOVED: updated_at: new Date()
        })
        .eq("id", existingRow.id);
    } else {
      console.log("🆕 Inserting new row for user:", user_id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending_direct",
          amount: app.price,
          razorpay_order_id: order.id
          // ❌ REMOVED: created_at, updated_at
        });
    }

    if (dbResult.error) {
      console.error("❌ Database error:", dbResult.error);
      return res.status(500).json({ error: "Database insert failed", details: dbResult.error });
    }

    console.log("✅ Database row created/updated");

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount
    });

  } catch (err) {
    console.error("🔥 Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ VERIFY DIRECT PAYMENT (Keep as is, but remove updated_at)
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
      .select("price")
      .eq("id", app_id)
      .single();

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (!existingRow) {
      return res.status(404).json({ error: "No subscription record found" });
    }

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0]
        // ❌ REMOVED: updated_at
      })
      .eq("id", existingRow.id);

    console.log(`✅ DIRECT PAYMENT ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ VERIFY TRIAL (Keep as is, but remove updated_at)
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    const crypto = await import("crypto");
    const sign = crypto.default
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_subscription_id + "|" + razorpay_payment_id)
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

    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (!existingRow) {
      return res.status(404).json({ error: "No subscription record found" });
    }

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0]
        // ❌ REMOVED: updated_at
      })
      .eq("id", existingRow.id);

    console.log(`✅ TRIAL ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true });

  } catch (err) {
    console.error("Verify trial error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// CREATE ORDER - with DB row create
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 1. Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

    // 2. Check if already has ACTIVE or TRIAL subscription
    const { data: activeSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (activeSub) {
      return res.status(400).json({ 
        error: "You already have an active subscription",
        status: activeSub.status,
        end_date: activeSub.end_date
      });
    }

    // 3. Create Razorpay order
    const order = await razorpay.orders.create({
      amount: app.price * 100,
      currency: "INR",
      receipt: `direct_${Date.now()}_${user_id.slice(0,8)}`,
      notes: {
        user_id: user_id,
        app_id: app_id,
        app_name: app.app_name
      }
    });

    // 4. UPSERT - Single row per user+app
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow) {
      // UPDATE existing row
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending_direct",
          amount: app.price,
          razorpay_order_id: order.id,
          razorpay_subscription_id: null,
          razorpay_payment_id: null,
          start_date: null,
          end_date: null,
          updated_at: new Date()
        })
        .eq("id", existingRow.id);
      console.log(`📝 Updated existing subscription: ${existingRow.id}`);
    } else {
      // CREATE new row
      await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending_direct",
          amount: app.price,
          razorpay_order_id: order.id,
          created_at: new Date(),
          updated_at: new Date()
        });
      console.log(`🆕 Created new subscription for user: ${user_id}`);
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount,
      price: app.price,
      description: `1 Year full access to ${app.app_name}`
    });

  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ VERIFY DIRECT PAYMENT
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 1. Verify signature
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // 2. Get app details
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    // 3. UPDATE the existing row to ACTIVE
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (!existingRow) {
      return res.status(404).json({ error: "No subscription record found" });
    }

    // Check if already active
    if (existingRow.status === "active") {
      return res.json({ success: true, already_active: true });
    }

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        updated_at: new Date()
      })
      .eq("id", existingRow.id);

    if (error) throw error;

    console.log(`✅ DIRECT PAYMENT ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ VERIFY TRIAL SUBSCRIPTION
router.post("/verify-subscription", async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 1. Verify signature
    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_subscription_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // 2. Get app for trial days
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    const trialDays = app?.trial_days || 7;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + trialDays);

    // 3. UPDATE the existing row to TRIAL
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (!existingRow) {
      return res.status(404).json({ error: "No subscription record found" });
    }

    // Check if already trial/active
    if (existingRow.status === "trial" || existingRow.status === "active") {
      return res.json({ success: true, already_active: true });
    }

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        updated_at: new Date()
      })
      .eq("id", existingRow.id);

    if (error) throw error;

    console.log(`✅ TRIAL ACTIVATED for ${trialDays} days: ${razorpay_payment_id}`);
    res.json({ success: true, trial_days: trialDays });

  } catch (err) {
    console.error("Verify trial error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ CANCEL/FAIL PAYMENT - Update status
router.post("/fail", async (req, res) => {
  try {
    const { user_id, app_id, reason } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow && existingRow.status === "pending") {
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "failed",
          updated_at: new Date()
        })
        .eq("id", existingRow.id);
      
      console.log(`❌ Payment failed/cancelled for user: ${user_id}, reason: ${reason || 'user_cancelled'}`);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Fail update error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

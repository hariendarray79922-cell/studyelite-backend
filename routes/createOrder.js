import express from "express";
import crypto from "crypto";

const router = express.Router();

// 🔥 PREMIUM ORDER - Create pending_direct first
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const Razorpay = await import("razorpay");
    
    const razorpay = new Razorpay.default({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    console.log("📥 Premium order request:", { app_id, user_id });

    // Validation
    if (!app_id || !user_id) {
      return res.status(400).json({ error: "app_id and user_id are required" });
    }

    // Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      console.error("App not found:", appError);
      return res.status(404).json({ error: "App not found" });
    }

    const fullPrice = app.price || 499;

    // Check existing subscription
    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow && existingRow.status === "active") {
      return res.status(400).json({ error: "Subscription already active" });
    }

    // 🔥 FIX: receipt length must be <= 40 characters
    // Use timestamp + short hash instead of full UUID
    const shortUserId = user_id.split('-')[0]; // Take first part only
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits
    const receipt = `prem_${shortUserId}_${timestamp}`.slice(0, 40);
    
    console.log("📝 Receipt:", receipt);

    // Create one-time order
    const order = await razorpay.orders.create({
      amount: fullPrice * 100,
      currency: "INR",
      receipt: receipt,
      notes: {
        type: "premium",
        app_id: app_id,
        user_id: user_id,
        is_recurring: false
      }
    });

    console.log("✅ Premium order created:", order.id);

    // UPSERT - Set status to pending_direct
    if (existingRow) {
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending_direct",
          amount: fullPrice,
          razorpay_order_id: order.id,
          updated_at: new Date().toISOString(),
          razorpay_payment_id: null,
          razorpay_subscription_id: null
        })
        .eq("id", existingRow.id);

      if (updateError) {
        console.error("DB update error:", updateError);
        return res.status(500).json({ error: "Failed to update order" });
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending_direct",
          amount: fullPrice,
          razorpay_order_id: order.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        console.error("DB insert error:", insertError);
        return res.status(500).json({ error: "Failed to save order" });
      }
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: fullPrice,
      is_recurring: false,
      status: "pending_direct"
    });

  } catch (err) {
    console.error("🔥 Premium order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 VERIFY PREMIUM PAYMENT - Update status to "active"
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Verify request:", { razorpay_order_id, razorpay_payment_id, user_id, app_id });

    // Validation
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !user_id || !app_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const sign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (sign !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 100); // Lifetime access

    // Update status to "active"
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id: razorpay_payment_id,
        razorpay_order_id: razorpay_order_id,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id);

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to verify payment" });
    }

    console.log(`✅ PREMIUM ACTIVATED: ${razorpay_payment_id}`);
    res.json({ success: true, status: "active" });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

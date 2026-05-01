import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔥 PREMIUM - ONE-TIME ORDER (No auto-debit)
router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Premium order request:", { app_id, user_id });

    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: "App not found" });
    }

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

    const fullPrice = app.price || 1499;

    // 🔥 FIX: Create ONE-TIME ORDER (no recurrence)
    const order = await razorpay.orders.create({
      amount: fullPrice * 100,
      currency: "INR",
      receipt: `premium_${user_id}_${Date.now()}`,
      notes: {
        type: "premium",
        app_id: app_id,
        user_id: user_id,
        is_recurring: false
      }
    });

    console.log("✅ Premium order created (one-time):", order.id);

    const currentTimestamp = new Date().toISOString();
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);  // 1 year access

    const { data: existingRow } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (existingRow) {
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending_direct",
          amount: fullPrice,
          razorpay_order_id: order.id,
          end_date: endDate.toISOString(),
          updated_at: currentTimestamp
        })
        .eq("id", existingRow.id);
    } else {
      await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending_direct",
          amount: fullPrice,
          razorpay_order_id: order.id,
          end_date: endDate.toISOString(),
          created_at: currentTimestamp,
          updated_at: currentTimestamp
        });
    }

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: fullPrice,
      is_recurring: false
    });

  } catch (err) {
    console.error("🔥 Premium order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Verify premium payment
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

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        razorpay_payment_id: razorpay_payment_id,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id);

    console.log(`✅ PREMIUM ACTIVATED (one-time): ${razorpay_payment_id}`);
    res.json({ success: true });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

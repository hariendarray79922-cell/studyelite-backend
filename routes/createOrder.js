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

    if (appError) {
      console.error("❌ App fetch error:", appError);
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

    // 🔥 INSERT into database
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
          razorpay_order_id: order.id,
          updated_at: new Date()
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
          razorpay_order_id: order.id,
          created_at: new Date(),
          updated_at: new Date()
        });
    }

    if (dbResult.error) {
      console.error("❌ Database error:", dbResult.error);
      return res.status(500).json({ error: "Database insert failed" });
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

// Keep your existing verify and verify-subscription endpoints
// ... (same as before)

// Remove the /fail endpoint for now
// router.post("/fail", ...) - remove this line

export default router;

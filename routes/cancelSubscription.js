import express from "express";

const router = express.Router();

// 🔥 CANCEL SUBSCRIPTION - Stop auto-debit before trial ends
router.post("/", async (req, res) => {
  try {
    const { subscription_id, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const Razorpay = await import("razorpay");
    
    const razorpay = new Razorpay.default({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    console.log("📥 Cancel request:", { subscription_id, user_id, app_id });

    // Cancel in Razorpay
    await razorpay.subscriptions.cancel(subscription_id);

    // Update in database
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString()
      })
      .eq("razorpay_subscription_id", subscription_id)
      .eq("user_id", user_id)
      .eq("app_id", app_id);

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to cancel subscription" });
    }

    console.log(`✅ SUBSCRIPTION CANCELLED: ${subscription_id}`);
    res.json({ success: true, message: "Subscription cancelled. No further auto-debit." });

  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

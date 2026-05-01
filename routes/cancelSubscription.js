import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔥 ACTUAL CANCEL SUBSCRIPTION
router.post("/", async (req, res) => {
  try {
    const { subscription_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    if (!subscription_id) {
      return res.status(400).json({ error: "subscription_id required" });
    }

    // Cancel in Razorpay
    const cancelled = await razorpay.subscriptions.cancel(subscription_id);

    // Update in database
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "cancelled_by_user",
        updated_at: new Date().toISOString()
      })
      .eq("razorpay_subscription_id", subscription_id);

    console.log(`✅ Subscription cancelled: ${subscription_id}`);
    res.json({ success: true, cancelled });

  } catch (err) {
    console.error("Cancel subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

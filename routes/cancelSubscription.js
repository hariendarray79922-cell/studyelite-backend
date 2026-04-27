import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.post("/:subscriptionId", async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    await razorpay.subscriptions.cancel(subscriptionId);

    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "trial_cancelled", updated_at: new Date() })
      .eq("razorpay_subscription_id", subscriptionId);

    res.json({ success: true });
  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

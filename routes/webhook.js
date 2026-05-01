import express from "express";
import crypto from "crypto";

const router = express.Router();

// 🔥 RAZORPAY WEBHOOK - Handle subscription charges
router.post("/razorpay", async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const { event, payload } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    // 🔥 When auto-debit happens after trial
    if (event === "subscription.charged") {
      const subId = payload.subscription.entity.id;
      const amount = payload.payment.entity.amount / 100;
      const paymentId = payload.payment.entity.id;

      console.log(`💰 Auto-debit received: ₹${amount} for ${subId}`);

      // Update subscription to active
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "active",
          razorpay_payment_id: paymentId,
          amount: amount,
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", subId);

      if (updateError) {
        console.error("DB update error:", updateError);
      } else {
        console.log(`✅ Subscription activated: ${subId}`);
      }
    }

    // 🔥 When subscription is cancelled
    if (event === "subscription.cancelled") {
      const subId = payload.subscription.entity.id;

      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", subId);

      console.log(`❌ Subscription cancelled: ${subId}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

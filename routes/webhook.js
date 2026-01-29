import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function webhook(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      console.log("❌ No signature header");
      return res.status(400).send("No signature");
    }

    const body = req.body.toString("utf8");

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )) {
      console.log("❌ Invalid signature");
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(body);
    const event = payload.event;

    console.log("✅ Webhook received:", event);

    /* 🔓 SUBSCRIPTION ACTIVATED */
    if (event === "subscription.activated") {
      const sub = payload.payload.subscription.entity;

      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          start_date: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id);

      console.log("✅ Subscription activated:", sub.id);
    }

    /* 💰 PAYMENT CAPTURED */
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;

      await supabase
        .from("subscriptions")
        .update({
          razorpay_payment_id: payment.id
        })
        .eq("razorpay_subscription_id", payment.subscription_id);

      console.log("✅ Payment saved:", payment.id);
    }

    /* ❌ PAYMENT FAILED */
    if (event === "invoice.payment_failed") {
      const invoice = payload.payload.invoice.entity;

      await supabase
        .from("subscriptions")
        .update({
          status: "expired"
        })
        .eq("razorpay_subscription_id", invoice.subscription_id);

      console.log("❌ Payment failed:", invoice.subscription_id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

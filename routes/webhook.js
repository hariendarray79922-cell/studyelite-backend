import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function webhook(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) return res.status(400).send("No signature");

    const body = req.body.toString("utf8");

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(body);
    const event = payload.event;

    console.log("📩 Webhook:", event);

    /* ✅ AUTOPAY APPROVED → TRIAL START */
    if (event === "subscription.authenticated") {
      const sub = payload.payload.subscription.entity;

      await supabase
        .from("subscriptions")
        .update({
          status: "trial",
          start_date: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id);

      console.log("✅ Trial started:", sub.id);
    }

    /* 💰 PAYMENT SUCCESS → ACTIVE */
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;

      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          razorpay_payment_id: payment.id,
          start_date: new Date().toISOString(),
          end_date: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000
          ).toISOString()
        })
        .eq("razorpay_subscription_id", payment.subscription_id);

      console.log("💰 Payment success → ACTIVE");
    }

    /* 🚫 AUTOPAY CANCEL */
    if (event === "subscription.cancelled") {
      const sub = payload.payload.subscription.entity;

      // check: payment hua ya nahi
      const { data } = await supabase
        .from("subscriptions")
        .select("razorpay_payment_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();

      // ❌ payment nahi hua → trial cancelled
      if (!data?.razorpay_payment_id) {
        await supabase
          .from("subscriptions")
          .update({ status: "trial_cancelled" })
          .eq("razorpay_subscription_id", sub.id);

        console.log("🚫 Trial cancelled (no payment)");
      } else {
        // ✅ payment ho chuka → ACTIVE rahega
        console.log("ℹ️ Autopay cancelled but paid user → access till end_date");
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

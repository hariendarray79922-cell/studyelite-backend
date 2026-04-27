import crypto from "crypto";

export default async function webhook(req, res) {
  let supabaseAdmin = null;
  
  try {
    supabaseAdmin = req.app.locals.supabaseAdmin;
    
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

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      console.error("Invalid JSON payload");
      return res.status(400).send("Invalid JSON");
    }

    const event = payload.event;
    console.log("📩 Webhook:", event);

    if (event === "subscription.authenticated") {
      const sub = payload.payload.subscription.entity;
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          updated_at: new Date()
        })
        .eq("razorpay_subscription_id", sub.id)
        .eq("status", "pending");
      console.log("✅ Trial started:", sub.id);
    }

    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "active",
          razorpay_payment_id: payment.id,
          updated_at: new Date()
        })
        .eq("razorpay_subscription_id", payment.subscription_id);
      console.log("💰 Payment captured → ACTIVE:", payment.id);
    }

    if (event === "subscription.cancelled") {
      const sub = payload.payload.subscription.entity;
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("razorpay_payment_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();

      if (!data?.razorpay_payment_id) {
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "trial_cancelled", updated_at: new Date() })
          .eq("razorpay_subscription_id", sub.id);
        console.log("🚫 Trial cancelled");
      } else {
        console.log("ℹ️ Paid user cancelled autopay");
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

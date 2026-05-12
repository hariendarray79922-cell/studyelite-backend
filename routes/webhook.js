import crypto from "crypto";

// 🔥 HELPER: Convert to Indian Time (IST)
function toIST(date) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(date.getTime() + istOffset);
}

export default async function webhook(req, res) {
  try {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    
    const body = req.body.toString();
    
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (signature !== expectedSignature) {
      console.error("❌ Invalid webhook signature");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const payload = JSON.parse(body);
    const { event } = payload;
    
    console.log("📩 Webhook received:", event);

    // 🔥 SUBSCRIPTION AUTHENTICATED (Trial payment done)
    if (event === "subscription.authenticated") {
      const sub = payload.payload.subscription.entity;
      
      // 🔥🔥🔥 Convert Razorpay start_at to IST
      const utcStartAt = new Date(sub.start_at * 1000);
      const istStartAt = toIST(utcStartAt);
      
      console.log(`🕐 Webhook - UTC Start: ${utcStartAt.toISOString()}`);
      console.log(`🕐 Webhook - IST Start: ${istStartAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
      
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
          razorpay_subscription_start_at: istStartAt.toISOString(), // 🔥 UPDATE IST
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id)
        .in("status", ["pending", "pending_trial"]);
      
      if (error) {
        console.error("Webhook update error:", error);
      } else {
        console.log("✅ Trial activated via webhook:", sub.id);
      }
    }

    // 🔥 PAYMENT CAPTURED (Direct payment or auto-debit)
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const subId = payment.subscription_id;
      const orderId = payment.order_id;
      
      if (subId) {
        const { error } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "active",
            razorpay_payment_id: payment.id,
            updated_at: new Date().toISOString()
          })
          .eq("razorpay_subscription_id", subId);
          
        if (error) {
          console.error("Webhook subscription update error:", error);
        } else {
          console.log("💰 Subscription payment captured:", payment.id);
        }
      } else if (orderId) {
        const { error } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "active",
            razorpay_payment_id: payment.id,
            updated_at: new Date().toISOString()
          })
          .eq("razorpay_order_id", orderId);
          
        if (error) {
          console.error("Webhook order update error:", error);
        } else {
          console.log("💰 Direct payment captured:", payment.id);
        }
      }
    }

    // 🔥 SUBSCRIPTION CANCELLED
    if (event === "subscription.cancelled") {
      const sub = payload.payload.subscription.entity;
      
      const { data: existing } = await supabaseAdmin
        .from("subscriptions")
        .select("razorpay_payment_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();

      if (!existing?.razorpay_payment_id) {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            status: "trial_cancelled", 
            updated_at: new Date().toISOString() 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log("🚫 Trial cancelled (no payment):", sub.id);
      } else {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            status: "cancelled", 
            updated_at: new Date().toISOString() 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log("⚠️ Paid subscription cancelled:", sub.id);
      }
    }

    res.json({ received: true });
    
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
}

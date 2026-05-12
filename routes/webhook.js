import crypto from "crypto";

export default async function webhook(req, res) {
  try {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    
    // Get raw body
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
      
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
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
        // Trial subscription payment
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
        // Direct order payment
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

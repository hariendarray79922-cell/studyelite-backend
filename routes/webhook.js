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
      return res.status(400).send("Invalid JSON");
    }

    const event = payload.event;
    console.log("📩 Webhook:", event);

    // 🔥 SUBSCRIPTION AUTHENTICATED → pending → trial
    if (event === "subscription.authenticated") {
      const sub = payload.payload.subscription.entity;
      
      // Get app details for trial days
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();
      
      let trialDays = 7; // default
      if (subscriptionRecord) {
        const { data: app } = await supabaseAdmin
          .from("apps")
          .select("trial_days")
          .eq("id", subscriptionRecord.app_id)
          .single();
        if (app) trialDays = app.trial_days || 7;
      }
      
      // 🔥 FIX: CORRECT DATE CALCULATION
      const now = new Date();
      const startDate = now.toISOString().split('T')[0];  // YYYY-MM-DD
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + trialDays);
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
          start_date: startDate,
          end_date: endDate.toISOString().split('T')[0],
          razorpay_payment_id: null,
          updated_at: new Date()
        })
        .eq("razorpay_subscription_id", sub.id)
        .eq("status", "pending");
      
      console.log(`✅ Trial started: ${sub.id} (${trialDays} days) from ${startDate} to ${endDate.toISOString().split('T')[0]}`);
    }

    // 🔥 PAYMENT CAPTURED → trial → active (for upfront payments)
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      
      // Get subscription and app details
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id, razorpay_payment_id, status")
        .eq("razorpay_subscription_id", payment.subscription_id)
        .single();
      
      if (!subscriptionRecord) {
        console.log(`⚠️ No subscription record for: ${payment.subscription_id}`);
        return res.json({ success: true });
      }
      
      // Check if already has payment (avoid duplicate)
      if (subscriptionRecord.razorpay_payment_id) {
        console.log(`ℹ️ Payment already recorded: ${payment.id}`);
        return res.json({ success: true });
      }
      
      // Get app details for plan duration
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("price, trial_days")
        .eq("id", subscriptionRecord.app_id)
        .single();
      
      // 🔥 FIX: CORRECT DATE CALCULATION
      const now = new Date();
      const startDate = now.toISOString().split('T')[0];
      let endDate = new Date(now);
      let newStatus = "";
      
      // Check if this is trial verification (₹2) or full payment
      const amountInRupees = payment.amount / 100;
      
      if (amountInRupees === 2) {
        // This is trial verification payment
        const trialDays = app?.trial_days || 7;
        endDate.setDate(endDate.getDate() + trialDays);
        newStatus = "trial";
        console.log(`✅ Trial verification payment received: ${payment.id} (${trialDays} days trial)`);
      } 
      else if (amountInRupees >= 100) {
        // This is full payment (₹1499 or similar)
        endDate.setFullYear(endDate.getFullYear() + 1);
        newStatus = "active";
        console.log(`✅ Full payment captured: ${payment.id} (1 year valid till ${endDate.toISOString().split('T')[0]})`);
      } else {
        // Unknown amount
        console.log(`⚠️ Unknown payment amount: ${amountInRupees}`);
        await supabaseAdmin
          .from("subscriptions")
          .update({
            razorpay_payment_id: payment.id,
            updated_at: new Date()
          })
          .eq("razorpay_subscription_id", payment.subscription_id);
        return res.json({ success: true });
      }
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: newStatus,
          razorpay_payment_id: payment.id,
          start_date: startDate,
          end_date: endDate.toISOString().split('T')[0],
          updated_at: new Date()
        })
        .eq("razorpay_subscription_id", payment.subscription_id);
    }

    // 🔥 SUBSCRIPTION CANCELLED
    if (event === "subscription.cancelled") {
      const sub = payload.payload.subscription.entity;
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("razorpay_payment_id, status")
        .eq("razorpay_subscription_id", sub.id)
        .single();

      if (!subscriptionRecord?.razorpay_payment_id) {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            status: "trial_cancelled", 
            updated_at: new Date() 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log("🚫 Trial cancelled (no payment made)");
      } else {
        // Paid user cancelled autopay, but access remains until end_date
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            updated_at: new Date(),
            autopay_cancelled: true 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log(`ℹ️ Paid user cancelled autopay, access till end_date`);
      }
    }

    // 🔥 SUBSCRIPTION ACTIVATED (fallback)
    if (event === "subscription.activated") {
      const sub = payload.payload.subscription.entity;
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          updated_at: new Date()
        })
        .eq("razorpay_subscription_id", sub.id);
      
      console.log(`✅ Subscription activated event: ${sub.id}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

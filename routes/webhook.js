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
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();
      
      let trialDays = 7;
      if (subscriptionRecord) {
        const { data: app } = await supabaseAdmin
          .from("apps")
          .select("trial_days")
          .eq("id", subscriptionRecord.app_id)
          .single();
        if (app) trialDays = app.trial_days || 7;
      }
      
      // 🔥 REAL TIME - Use Razorpay's start_at timestamp
      const razorpayStartAt = sub.start_at; // UNIX timestamp from Razorpay
      const startDate = new Date(razorpayStartAt * 1000);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + trialDays);
      
      const now = new Date();
      
      console.log(`📅 Razorpay Start At: ${razorpayStartAt}`);
      console.log(`📅 Start Date (UTC): ${startDate.toISOString()}`);
      console.log(`📅 Start Date (IST): ${startDate.toLocaleString("en-IN", {timeZone: "Asia/Kolkata"})}`);
      console.log(`📅 End Date (UTC): ${endDate.toISOString()}`);
      console.log(`📅 End Date (IST): ${endDate.toLocaleString("en-IN", {timeZone: "Asia/Kolkata"})}`);
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          razorpay_payment_id: null,
          updated_at: now.toISOString()
        })
        .eq("razorpay_subscription_id", sub.id)
        .eq("status", "pending");
      
      console.log(`✅ Trial started: ${sub.id} (${trialDays} days)`);
    }

    // 🔥 PAYMENT CAPTURED
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id, razorpay_payment_id, status")
        .eq("razorpay_subscription_id", payment.subscription_id)
        .single();
      
      if (!subscriptionRecord) {
        console.log(`⚠️ No subscription record for: ${payment.subscription_id}`);
        return res.json({ success: true });
      }
      
      if (subscriptionRecord.razorpay_payment_id) {
        console.log(`ℹ️ Payment already recorded: ${payment.id}`);
        return res.json({ success: true });
      }
      
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("price, trial_days")
        .eq("id", subscriptionRecord.app_id)
        .single();
      
      const amountInRupees = payment.amount / 100;
      const now = new Date();
      let startDate = new Date();
      let endDate = new Date();
      let newStatus = "";
      
      if (amountInRupees === 2) {
        const trialDays = app?.trial_days || 7;
        startDate = new Date(); // Current time
        endDate = new Date();
        endDate.setDate(endDate.getDate() + trialDays);
        newStatus = "trial";
        console.log(`✅ Trial verification payment: ${payment.id} (${trialDays} days trial)`);
      } 
      else if (amountInRupees >= 100) {
        startDate = new Date(); // Current time
        endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
        newStatus = "active";
        console.log(`✅ Full payment captured: ${payment.id} (1 year valid)`);
      } else {
        console.log(`⚠️ Unknown payment amount: ${amountInRupees}`);
        await supabaseAdmin
          .from("subscriptions")
          .update({
            razorpay_payment_id: payment.id,
            updated_at: now.toISOString()
          })
          .eq("razorpay_subscription_id", payment.subscription_id);
        return res.json({ success: true });
      }
      
      console.log(`📅 Start (UTC): ${startDate.toISOString()}`);
      console.log(`📅 Start (IST): ${startDate.toLocaleString("en-IN", {timeZone: "Asia/Kolkata"})}`);
      console.log(`📅 End (UTC): ${endDate.toISOString()}`);
      console.log(`📅 End (IST): ${endDate.toLocaleString("en-IN", {timeZone: "Asia/Kolkata"})}`);
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: newStatus,
          razorpay_payment_id: payment.id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          updated_at: now.toISOString()
        })
        .eq("razorpay_subscription_id", payment.subscription_id);
    }

    // 🔥 SUBSCRIPTION CANCELLED
    if (event === "subscription.cancelled") {
      const sub = payload.payload.subscription.entity;
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("razorpay_payment_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();

      if (!subscriptionRecord?.razorpay_payment_id) {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            status: "trial_cancelled", 
            updated_at: new Date().toISOString()
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log("🚫 Trial cancelled (no payment made)");
      } else {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            updated_at: new Date().toISOString(),
            autopay_cancelled: true 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log(`ℹ️ Paid user cancelled autopay, access till end_date`);
      }
    }

    // 🔥 SUBSCRIPTION ACTIVATED
    if (event === "subscription.activated") {
      const sub = payload.payload.subscription.entity;
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id);
      
      console.log(`✅ Subscription activated: ${sub.id}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

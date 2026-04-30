import crypto from "crypto";

// 🔥 HELPER: Get IST timestamp
function getISTTimestamp() {
  const now = new Date();
  // Convert to IST (UTC + 5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString();
}

// 🔥 HELPER: Add days to IST date
function addDaysToIST(days) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  istDate.setDate(istDate.getDate() + days);
  // Convert back to UTC for storage (but keep time)
  const utcDate = new Date(istDate.getTime() - istOffset);
  return utcDate.toISOString();
}

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
      
      // 🔥 FIX: Use IST time for calculation
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const startIST = new Date(now.getTime() + istOffset);
      const endIST = new Date(startIST);
      endIST.setDate(endIST.getDate() + trialDays);
      
      // Store in UTC but with correct time
      const startUTC = new Date(startIST.getTime() - istOffset);
      const endUTC = new Date(endIST.getTime() - istOffset);
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "trial",
          start_date: startUTC.toISOString(),
          end_date: endUTC.toISOString(),
          razorpay_payment_id: null,
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id)
        .eq("status", "pending");
      
      console.log(`✅ Trial started: ${sub.id} (${trialDays} days)`);
      console.log(`   Start (IST): ${startIST.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
      console.log(`   End (IST): ${endIST.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
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
      const istOffset = 5.5 * 60 * 60 * 1000;
      const now = new Date();
      const startIST = new Date(now.getTime() + istOffset);
      let endIST = new Date(startIST);
      let newStatus = "";
      
      if (amountInRupees === 2) {
        const trialDays = app?.trial_days || 7;
        endIST.setDate(endIST.getDate() + trialDays);
        newStatus = "trial";
        console.log(`✅ Trial verification: ${payment.id} (${trialDays} days)`);
      } 
      else if (amountInRupees >= 100) {
        endIST.setFullYear(endIST.getFullYear() + 1);
        newStatus = "active";
        console.log(`✅ Full payment: ${payment.id} (1 year)`);
      } else {
        console.log(`⚠️ Unknown amount: ${amountInRupees}`);
        await supabaseAdmin
          .from("subscriptions")
          .update({
            razorpay_payment_id: payment.id,
            updated_at: new Date().toISOString()
          })
          .eq("razorpay_subscription_id", payment.subscription_id);
        return res.json({ success: true });
      }
      
      // Convert back to UTC for storage
      const startUTC = new Date(startIST.getTime() - istOffset);
      const endUTC = new Date(endIST.getTime() - istOffset);
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: newStatus,
          razorpay_payment_id: payment.id,
          start_date: startUTC.toISOString(),
          end_date: endUTC.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", payment.subscription_id);
      
      console.log(`   Start (IST): ${startIST.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
      console.log(`   End (IST): ${endIST.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
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
        console.log("🚫 Trial cancelled (no payment)");
      } else {
        await supabaseAdmin
          .from("subscriptions")
          .update({ 
            updated_at: new Date().toISOString(),
            autopay_cancelled: true 
          })
          .eq("razorpay_subscription_id", sub.id);
        console.log(`ℹ️ AutoPay cancelled, access till end_date`);
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

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

    // 🔥 SUBSCRIPTION AUTHENTICATED (Mandate approved, NOT payment)
    if (event === "subscription.authenticated") {
      const sub = payload.payload.subscription.entity;
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id")
        .eq("razorpay_subscription_id", sub.id)
        .single();
      
      // Just update status to indicate mandate approved
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "mandate_approved",
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id)
        .eq("status", "pending");
      
      console.log(`✅ Mandate approved: ${sub.id}`);
    }

    // 🔥 INVOICE PAID - Real payment success
    if (event === "invoice.paid") {
      const invoice = payload.payload.invoice.entity;
      const subscriptionId = invoice.subscription_id;
      
      const { data: subscriptionRecord } = await supabaseAdmin
        .from("subscriptions")
        .select("app_id")
        .eq("razorpay_subscription_id", subscriptionId)
        .single();
      
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("trial_days, price")
        .eq("id", subscriptionRecord.app_id)
        .single();
      
      const amountInRupees = invoice.amount / 100;
      const now = new Date();
      let endDate = new Date();
      let newStatus = "";
      
      if (amountInRupees === 2) {
        const trialDays = app?.trial_days || 7;
        endDate.setDate(endDate.getDate() + trialDays);
        newStatus = "trial";
      } else if (amountInRupees >= 100) {
        endDate.setFullYear(endDate.getFullYear() + 1);
        newStatus = "active";
      }
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: newStatus,
          razorpay_payment_id: invoice.id,
          start_date: now.toISOString(),
          end_date: endDate.toISOString(),
          updated_at: now.toISOString()
        })
        .eq("razorpay_subscription_id", subscriptionId);
      
      console.log(`✅ Invoice paid: ${invoice.id} → ${newStatus}`);
    }

    // 🔥 INVOICE PAYMENT FAILED
    if (event === "invoice.payment_failed") {
      const invoice = payload.payload.invoice.entity;
      const subscriptionId = invoice.subscription_id;
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "payment_failed",
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", subscriptionId);
      
      console.log(`❌ Payment failed for subscription: ${subscriptionId}`);
    }

    // 🔥 SUBSCRIPTION HALTED (Repeated failures)
    if (event === "subscription.halted") {
      const sub = payload.payload.subscription.entity;
      
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "halted",
          halted_reason: "payment_failed_repeated",
          updated_at: new Date().toISOString()
        })
        .eq("razorpay_subscription_id", sub.id);
      
      console.log(`⏸️ Subscription halted: ${sub.id}`);
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

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("Webhook error");
  }
}

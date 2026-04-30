import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

export async function checkPendingSubscriptions() {
  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .in("status", ["pending", "trial"]);

    if (!subs || subs.length === 0) {
      console.log("ℹ️ No pending / trial subscriptions");
      return;
    }

    for (const sub of subs) {
      try {
        if (sub.razorpay_subscription_id) {
          const rpSub = await razorpay.subscriptions.fetch(sub.razorpay_subscription_id);
          console.log("🔎 Subscription:", sub.razorpay_subscription_id, rpSub.status);

          if (sub.status === "pending" && rpSub.status === "authenticated") {
            const appId = sub.app_id;
            
            const { data: app } = await supabaseAdmin
              .from("apps")
              .select("trial_days")
              .eq("id", appId)
              .single();
            
            const trialDays = app?.trial_days || 7;
            
            // 🔥 REAL TIME - Use Razorpay's start_at
            const razorpayStartAt = rpSub.start_at;
            const startDate = new Date(razorpayStartAt * 1000);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + trialDays);
            
            console.log(`📅 Start Date (UTC): ${startDate.toISOString()}`);
            console.log(`📅 End Date (UTC): ${endDate.toISOString()}`);
            
            await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "trial",
                start_date: startDate.toISOString(),
                end_date: endDate.toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log(`✅ Trial started via checker: ${sub.id}`);
          }

          if (sub.status === "trial" && rpSub.status === "cancelled" && !sub.razorpay_payment_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "trial_cancelled", 
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log("🚫 Trial revoked (autopay cancelled):", sub.id);
          }
        }
      } catch (e) {
        console.log("⏭️ Skipped:", sub.razorpay_subscription_id);
      }
    }
  } catch (err) {
    console.log("🔥 Checker error:", err.message);
  }
}

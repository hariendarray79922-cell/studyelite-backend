import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

let supabaseAdmin = null;

export async function checkPendingSubscriptions() {
  try {
    supabaseAdmin = createClient(
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
            await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "trial",
                start_date: new Date().toISOString().split('T')[0],
                end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                updated_at: new Date()
              })
              .eq("id", sub.id);
            console.log("✅ Trial started:", sub.id);
          }

          if (sub.status === "trial" && rpSub.status === "cancelled" && !sub.razorpay_payment_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ status: "trial_cancelled", updated_at: new Date() })
              .eq("id", sub.id);
            console.log("🚫 Trial revoked:", sub.id);
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

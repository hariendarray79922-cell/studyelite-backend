import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function checkPendingSubscriptions() {
  try {
    // 🔥 IMPORTANT: pending + trial dono check honge
    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("*")
      .in("status", ["pending", "trial"]);

    if (error || !subs || subs.length === 0) {
      console.log("ℹ️ No pending / trial subscriptions");
      return;
    }

    for (const sub of subs) {
      try {
        const rpSub = await razorpay.subscriptions.fetch(
          sub.razorpay_subscription_id
        );

        console.log(
          "🔎 Razorpay:",
          sub.razorpay_subscription_id,
          rpSub.status
        );

        /* ✅ AUTOPAY APPROVED → TRIAL START */
        if (
          sub.status === "pending" &&
          rpSub.status === "authenticated"
        ) {
          await supabase
            .from("subscriptions")
            .update({
              status: "trial",
              start_date: new Date().toISOString()
            })
            .eq("id", sub.id);

          console.log("✅ Trial started:", sub.id);
        }

        /* 🚫 TRIAL + AUTOPAY CANCELLED → ACCESS REMOVE */
        if (
          sub.status === "trial" &&
          rpSub.status === "cancelled" &&
          !sub.razorpay_payment_id
        ) {
          await supabase
            .from("subscriptions")
            .update({
              status: "trial_cancelled"
            })
            .eq("id", sub.id);

          console.log("🚫 Trial revoked (autopay cancelled):", sub.id);
        }

        /* ℹ️ PAID USER → IGNORE CANCEL */
        if (
          rpSub.status === "cancelled" &&
          sub.razorpay_payment_id
        ) {
          console.log(
            "ℹ️ Paid user cancelled autopay → access till end_date"
          );
        }

      } catch (e) {
        console.log("⏭️ Skipped:", sub.razorpay_subscription_id);
      }
    }
  } catch (err) {
    console.log("🔥 Checker error:", err.message);
  }
}

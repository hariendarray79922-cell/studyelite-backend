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
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("status", "pending");

    if (!subs || subs.length === 0) return;

    for (const sub of subs) {
      const rpSub = await razorpay.subscriptions.fetch(
        sub.razorpay_subscription_id
      );

      console.log("🔎 Razorpay:", rpSub.status);

      if (rpSub.status === "authenticated") {
        await supabase
          .from("subscriptions")
          .update({
            status: "trial",
            start_date: new Date().toISOString()
          })
          .eq("id", sub.id);

        console.log("✅ Trial started (backup)");
      }

      if (rpSub.status === "cancelled") {
        await supabase
          .from("subscriptions")
          .update({ status: "trial_cancelled" })
          .eq("id", sub.id);

        console.log("🚫 Trial cancelled (backup)");
      }
    }
  } catch (err) {
    console.log("🔥 Checker error:", err.message);
  }
}

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

    // Check ALL active/trial subscriptions (not just pending)
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .in("status", ["pending", "trial", "active", "halted"]);

    if (!subs || subs.length === 0) {
      console.log("ℹ️ No subscriptions to check");
      return;
    }

    const now = new Date();

    for (const sub of subs) {
      try {
        // 🔥 CHECK 1: EXPIRED SUBSCRIPTIONS (end_date passed)
        if (sub.end_date && new Date(sub.end_date) < now && sub.status === "active") {
          await supabaseAdmin
            .from("subscriptions")
            .update({ 
              status: "expired", 
              updated_at: new Date().toISOString()
            })
            .eq("id", sub.id);
          console.log(`⏰ Subscription expired: ${sub.id} (ended on ${sub.end_date})`);
          continue;
        }

        // 🔥 CHECK 2: HALTED SUBSCRIPTIONS (trial ended without payment)
        if (sub.status === "trial" && sub.end_date && new Date(sub.end_date) < now) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ 
              status: "halted", 
              halted_reason: "trial_expired_no_payment",
              updated_at: new Date().toISOString()
            })
            .eq("id", sub.id);
          console.log(`⏸️ Trial halted (expired without payment): ${sub.id}`);
          continue;
        }

        // 🔥 CHECK 3: Check with Razorpay for real status
        if (sub.razorpay_subscription_id) {
          const rpSub = await razorpay.subscriptions.fetch(sub.razorpay_subscription_id);
          console.log("🔎 Subscription:", sub.razorpay_subscription_id, rpSub.status);

          // Pending → Authenticated (Payment done)
          if (sub.status === "pending" && rpSub.status === "authenticated") {
            const appId = sub.app_id;
            const { data: app } = await supabaseAdmin
              .from("apps")
              .select("trial_days")
              .eq("id", appId)
              .single();
            
            const trialDays = app?.trial_days || 7;
            const razorpayStartAt = rpSub.start_at;
            const startDate = new Date(razorpayStartAt * 1000);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + trialDays);
            
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

          // Trial → Cancelled (User cancelled autopay)
          if (sub.status === "trial" && rpSub.status === "cancelled" && !sub.razorpay_payment_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "trial_cancelled", 
                cancelled_reason: "autopay_cancelled",
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log("🚫 Trial cancelled (autopay off):", sub.id);
          }

          // Active → Halted (Payment failed)
          if (sub.status === "active" && rpSub.status === "halted") {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "halted", 
                halted_reason: "payment_failed",
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log("⏸️ Subscription halted (payment failed):", sub.id);
          }

          // Active → Completed (All cycles done)
          if (sub.status === "active" && rpSub.status === "completed") {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "completed", 
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log("✅ Subscription completed all cycles:", sub.id);
          }
        }
      } catch (e) {
        console.log("⏭️ Skipped:", sub.razorpay_subscription_id, e.message);
      }
    }
  } catch (err) {
    console.log("🔥 Checker error:", err.message);
  }
}

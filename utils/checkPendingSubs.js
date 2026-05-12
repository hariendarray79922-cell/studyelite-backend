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

    // 🔥 Check all pending and trial subscriptions
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("*, apps(trial_days)")
      .in("status", ["pending", "pending_trial", "pending_direct", "trial", "active"]);

    if (!subs || subs.length === 0) {
      // Silent - no log spam
      return;
    }

    console.log(`🔍 Checking ${subs.length} subscriptions...`);
    let updated = 0;

    for (const sub of subs) {
      try {
        // 🔥 CHECK 1: pending_direct - Check if too old (30 minutes)
        if (sub.status === "pending_direct" && sub.created_at) {
          const created = new Date(sub.created_at);
          const now = new Date();
          const minutesPassed = (now - created) / (1000 * 60);
          
          if (minutesPassed > 30) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "failed", 
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log(`⏰ Direct payment expired: ${sub.id}`);
            updated++;
            continue;
          }
        }
        
        // 🔥 CHECK 2: Check with Razorpay
        if (sub.razorpay_subscription_id) {
          const rpSub = await razorpay.subscriptions.fetch(sub.razorpay_subscription_id);
          
          // pending → authenticated (payment done)
          if ((sub.status === "pending" || sub.status === "pending_trial") && rpSub.status === "authenticated") {
            const trialDays = sub.apps?.trial_days || 7;
            const startDate = new Date(rpSub.start_at * 1000);
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
            updated++;
          }
          
          // trial → active (first payment captured)
          if (sub.status === "trial" && rpSub.status === "active") {
            await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "active",
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log(`✅ Subscription active via checker: ${sub.id}`);
            updated++;
          }
          
          // trial → cancelled (user cancelled)
          if (sub.status === "trial" && rpSub.status === "cancelled" && !sub.razorpay_payment_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "trial_cancelled", 
                updated_at: new Date().toISOString()
              })
              .eq("id", sub.id);
            console.log(`🚫 Trial cancelled: ${sub.id}`);
            updated++;
          }
        }
        
        // 🔥 CHECK 3: Check direct orders
        if (sub.razorpay_order_id && sub.status === "pending_direct") {
          try {
            const order = await razorpay.orders.fetch(sub.razorpay_order_id);
            if (order.status === "paid") {
              const start = new Date();
              const end = new Date();
              end.setFullYear(end.getFullYear() + 100);
              
              await supabaseAdmin
                .from("subscriptions")
                .update({
                  status: "active",
                  start_date: start.toISOString(),
                  end_date: end.toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq("id", sub.id);
              console.log(`✅ Direct order paid via checker: ${sub.id}`);
              updated++;
            }
          } catch (e) {
            // Order not found or error
          }
        }
        
        // 🔥 CHECK 4: Expired subscriptions
        if (sub.end_date && new Date(sub.end_date) < new Date() && (sub.status === "trial" || sub.status === "active")) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ 
              status: sub.status === "trial" ? "expired" : "expired",
              updated_at: new Date().toISOString()
            })
            .eq("id", sub.id);
          console.log(`⏰ Subscription expired: ${sub.id}`);
          updated++;
        }
        
      } catch (e) {
        console.log(`⏭️ Skipped ${sub.id}:`, e.message);
      }
    }
    
    if (updated > 0) {
      console.log(`✅ Updated ${updated} subscriptions`);
    }

  } catch (err) {
    console.log("🔥 Checker error:", err.message);
  }
}

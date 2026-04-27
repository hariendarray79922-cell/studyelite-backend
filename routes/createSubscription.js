import express from "express";
import Razorpay from "razorpay";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.post("/", async (req, res) => {
  try {
    const { app_id, user_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    console.log("📥 Request received:", { app_id, user_id });

    // 1. Get app details
    const { data: app, error: appError } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("id", app_id)
      .single();

    if (appError) {
      console.error("❌ App fetch error:", appError);
      return res.status(404).json({ error: "App not found", details: appError });
    }

    console.log("✅ App found:", app.app_name);

    // 2. Check existing active subscription
    const { data: activeSub, error: checkError } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .in("status", ["active", "trial"])
      .maybeSingle();

    if (activeSub) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    const TRIAL_AMOUNT = 2;
    const trialDays = app.trial_days || 7;

    // 3. Create Razorpay subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: app.razorpay_plan_id,
      customer_notify: 1,
      total_count: 1,
      start_at: Math.floor(Date.now() / 1000),
      addons: [
        {
          item: {
            name: `${app.app_name} - ${trialDays} Days Trial`,
            amount: TRIAL_AMOUNT * 100,
            currency: "INR"
          }
        }
      ]
    });

    console.log("✅ Razorpay subscription created:", subscription.id);

    // 4. 🔥 CRITICAL: INSERT into database with proper error handling
    const { data: existingRow, error: findError } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .maybeSingle();

    if (findError) {
      console.error("❌ Find error:", findError);
    }

    let dbResult;
    if (existingRow) {
      console.log("📝 Updating existing row:", existingRow.id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          updated_at: new Date()
        })
        .eq("id", existingRow.id)
        .select();
    } else {
      console.log("🆕 Inserting new row for user:", user_id);
      dbResult = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user_id,
          app_id: app_id,
          status: "pending",
          amount: TRIAL_AMOUNT,
          razorpay_subscription_id: subscription.id,
          created_at: new Date(),
          updated_at: new Date()
        })
        .select();
    }

    if (dbResult.error) {
      console.error("❌ Database error:", dbResult.error);
      return res.status(500).json({ error: "Database insert failed", details: dbResult.error });
    }

    console.log("✅ Database row created/updated:", dbResult.data?.[0]?.id);

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      amount: TRIAL_AMOUNT,
      trial_days: trialDays
    });

  } catch (err) {
    console.error("🔥 Create subscription error:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

export default router;

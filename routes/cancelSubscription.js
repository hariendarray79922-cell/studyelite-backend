import express from "express";

const router = express.Router();

// 🔥 CANCEL TRIAL SUBSCRIPTION - Update status to "trial_cancelled"
router.post("/", async (req, res) => {
  try {
    const { razorpay_subscription_id, user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const Razorpay = await import("razorpay");
    
    const razorpay = new Razorpay.default({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    console.log("📥 Cancel request:", { razorpay_subscription_id, user_id, app_id });

    if (!razorpay_subscription_id) {
      return res.status(400).json({ error: "subscription_id required" });
    }

    // Cancel in Razorpay
    await razorpay.subscriptions.cancel(razorpay_subscription_id);

    // Update status to "trial_cancelled"
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial_cancelled",
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .eq("razorpay_subscription_id", razorpay_subscription_id);

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to cancel subscription" });
    }

    console.log(`✅ TRIAL CANCELLED: ${razorpay_subscription_id}`);
    res.json({ success: true, status: "trial_cancelled" });

  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 HALT TRIAL (if auto-pay off)
router.post("/halt", async (req, res) => {
  try {
    const { user_id, app_id } = req.body;
    const supabaseAdmin = req.app.locals.supabaseAdmin;

    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "trial_halted",
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user_id)
      .eq("app_id", app_id)
      .eq("status", "trial");

    if (updateError) {
      console.error("DB update error:", updateError);
      return res.status(500).json({ error: "Failed to halt trial" });
    }

    console.log(`✅ TRIAL HALTED: ${user_id} - ${app_id}`);
    res.json({ success: true, status: "trial_halted" });

  } catch (err) {
    console.error("Halt error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

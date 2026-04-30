import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();
const otpStore = new Map();

// ============ SEND EMAIL VIA GMAIL API ============
async function sendEmailViaGmailAPI(to, subject, htmlContent) {
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });
    
    const { access_token } = await tokenResponse.json();
    
    if (!access_token) {
      console.log("❌ Failed to get access token");
      return { success: false };
    }
    
    const messageParts = [];
    messageParts.push(`To: ${to}`);
    messageParts.push(`Subject: ${subject}`);
    messageParts.push('Content-Type: text/html; charset=UTF-8');
    messageParts.push('');
    messageParts.push(htmlContent);
    
    const emailMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(emailMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw: encodedMessage })
    });
    
    if (response.ok) {
      console.log(`✅ Email sent to ${to}`);
      return { success: true };
    } else {
      const error = await response.text();
      console.log(`❌ Gmail API error: ${error}`);
      return { success: false };
    }
    
  } catch (err) {
    console.log(`❌ Email error: ${err.message}`);
    return { success: false };
  }
}

// ============ SEND OTP VIA SMS ============
async function sendSMS(phone, otp) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch("https://sms.studyelite.shop/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: phone, message: `Your OTP is ${otp}` }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch (err) {
    console.log("❌ SMS error:", err.message);
    return false;
  }
}

// ============ CHECK IF USER IS BLOCKED ============
async function isUserBlocked(phone, email, supabaseAdmin) {
  if (!supabaseAdmin) return { blocked: false };
  
  try {
    if (phone) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked")
        .eq("phone", phone)
        .maybeSingle();
      if (data?.is_blocked === true) return { blocked: true };
    }
    
    if (email) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_blocked")
        .eq("email", email)
        .maybeSingle();
      if (data?.is_blocked === true) return { blocked: true };
    }
  } catch (err) {
    console.error("Block check error:", err);
  }
  
  return { blocked: false };
}

// ============ CLEANUP ============
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============ SEND OTP ROUTE ============
router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ success: false, error: "Account blocked", blocked: true });
  }

  let otp;
  const existing = otpStore.get(identifier);
  
  if (resend && existing && (Date.now() - existing.timestamp < 5 * 60 * 1000)) {
    otp = existing.otp;
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(identifier, { otp, timestamp: Date.now() });
  }
  
  console.log("📱 OTP:", otp, "for:", identifier);

  let smsSent = false;
  let emailSent = false;

  if (phone) {
    smsSent = await sendSMS(phone, otp);
    console.log("📲 SMS:", smsSent ? "✅" : "❌");
  }

  if ((!smsSent || resend) && email && process.env.GMAIL_REFRESH_TOKEN) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 30px;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
          <h2 style="color: #4f46e5;">🔐 StudyElite</h2>
          <h1 style="font-size: 52px; letter-spacing: 8px; color: #2563eb;">${otp}</h1>
          <p>This OTP is valid for <strong>5 minutes</strong>.</p>
        </div>
      </body>
      </html>
    `;
    
    const result = await sendEmailViaGmailAPI(email, "🔐 Your OTP Code - StudyElite", htmlContent);
    emailSent = result.success;
    console.log("📧 Email:", emailSent ? "✅" : "❌");
  }

  res.json({ success: smsSent || emailSent, sms: smsSent, email: emailSent });
});

// ============ VERIFY OTP ROUTE ============
router.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const stored = otpStore.get(identifier);

  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true });
  }
  
  res.json({ success: false, error: "Invalid or expired OTP" });
});

export default router;

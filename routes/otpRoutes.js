import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();
const otpStore = new Map();

// 🔥 NEW: Rate limit stores
const emailRateStore = new Map();  // { key: { count, firstAttemptTime } }
const smsRateStore = new Map();    // { key: { count, firstAttemptTime } }
const resendCooldownStore = new Map(); // { key: timestamp }

// ============ RATE LIMIT CONFIG ============
const CONFIG = {
  EMAIL_LIMIT: 3,      // 3 emails per 24 hours
  SMS_LIMIT: 2,        // 2 SMS per 24 hours
  RESEND_COOLDOWN: 120, // 120 seconds
  OTP_EXPIRY: 5 * 60 * 1000, // 5 minutes
  WINDOW_MS: 24 * 60 * 60 * 1000 // 24 hours
};

// ============ CHECK EMAIL RATE LIMIT ============
function checkEmailRateLimit(identifier) {
  const now = Date.now();
  const record = emailRateStore.get(identifier);
  
  if (!record) {
    emailRateStore.set(identifier, { count: 1, firstAttemptTime: now });
    return { allowed: true, remaining: CONFIG.EMAIL_LIMIT - 1 };
  }
  
  // Reset if window expired
  if (now - record.firstAttemptTime > CONFIG.WINDOW_MS) {
    emailRateStore.set(identifier, { count: 1, firstAttemptTime: now });
    return { allowed: true, remaining: CONFIG.EMAIL_LIMIT - 1 };
  }
  
  if (record.count >= CONFIG.EMAIL_LIMIT) {
    const resetTime = record.firstAttemptTime + CONFIG.WINDOW_MS;
    return { allowed: false, remaining: 0, resetTime };
  }
  
  record.count++;
  emailRateStore.set(identifier, record);
  return { allowed: true, remaining: CONFIG.EMAIL_LIMIT - record.count };
}

// ============ CHECK SMS RATE LIMIT ============
function checkSMSRateLimit(identifier) {
  const now = Date.now();
  const record = smsRateStore.get(identifier);
  
  if (!record) {
    smsRateStore.set(identifier, { count: 1, firstAttemptTime: now });
    return { allowed: true, remaining: CONFIG.SMS_LIMIT - 1 };
  }
  
  if (now - record.firstAttemptTime > CONFIG.WINDOW_MS) {
    smsRateStore.set(identifier, { count: 1, firstAttemptTime: now });
    return { allowed: true, remaining: CONFIG.SMS_LIMIT - 1 };
  }
  
  if (record.count >= CONFIG.SMS_LIMIT) {
    const resetTime = record.firstAttemptTime + CONFIG.WINDOW_MS;
    return { allowed: false, remaining: 0, resetTime };
  }
  
  record.count++;
  smsRateStore.set(identifier, record);
  return { allowed: true, remaining: CONFIG.SMS_LIMIT - record.count };
}

// ============ CHECK RESEND COOLDOWN ============
function checkResendCooldown(identifier) {
  const lastResend = resendCooldownStore.get(identifier);
  if (lastResend && (Date.now() - lastResend < CONFIG.RESEND_COOLDOWN * 1000)) {
    const remainingSeconds = Math.ceil((CONFIG.RESEND_COOLDOWN * 1000 - (Date.now() - lastResend)) / 1000);
    return { allowed: false, remainingSeconds };
  }
  return { allowed: true };
}

function updateResendCooldown(identifier) {
  resendCooldownStore.set(identifier, Date.now());
}

// ============ CLEANUP RATE LIMIT STORES ============
setInterval(() => {
  const now = Date.now();
  
  for (const [key, value] of emailRateStore.entries()) {
    if (now - value.firstAttemptTime > CONFIG.WINDOW_MS) {
      emailRateStore.delete(key);
    }
  }
  
  for (const [key, value] of smsRateStore.entries()) {
    if (now - value.firstAttemptTime > CONFIG.WINDOW_MS) {
      smsRateStore.delete(key);
    }
  }
  
  for (const [key, value] of resendCooldownStore.entries()) {
    if (now - value > CONFIG.RESEND_COOLDOWN * 1000) {
      resendCooldownStore.delete(key);
    }
  }
}, 60 * 1000); // Cleanup every minute

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
    
    return { success: response.ok };
    
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
    return { success: response.ok };
  } catch (err) {
    console.log("❌ SMS error:", err.message);
    return { success: false };
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

// ============ CLEANUP OTP STORE ============
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now - value.timestamp > CONFIG.OTP_EXPIRY) {
      otpStore.delete(key);
    }
  }
}, 60 * 1000);

// ============ SEND OTP ROUTE ============
router.post("/send-otp", async (req, res) => {
  const { email, phone, resend } = req.body;
  const identifier = phone || email;
  const supabaseAdmin = req.app.locals.supabaseAdmin;

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  // Check if user is blocked by admin
  const blockCheck = await isUserBlocked(phone, email, supabaseAdmin);
  if (blockCheck.blocked) {
    return res.status(403).json({ success: false, error: "Account blocked", blocked: true });
  }

  // 🔥 RESEND COOLDOWN CHECK (only for resend)
  if (resend === true) {
    const cooldownCheck = checkResendCooldown(identifier);
    if (!cooldownCheck.allowed) {
      return res.status(429).json({ 
        success: false, 
        error: `Please wait ${cooldownCheck.remainingSeconds} seconds before resending`,
        cooldown: cooldownCheck.remainingSeconds
      });
    }
  }

  // Generate OTP
  let otp;
  const existing = otpStore.get(identifier);
  
  if (resend && existing && (Date.now() - existing.timestamp < CONFIG.OTP_EXPIRY)) {
    otp = existing.otp;
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(identifier, { otp, timestamp: Date.now() });
  }
  
  console.log("📱 OTP:", otp, "for:", identifier);

  let smsResult = { success: false };
  let emailResult = { success: false };
  let rateLimitInfo = {};

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial, sans-serif; text-align: center; padding: 30px;">
      <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
        <h2 style="color: #4f46e5;">🔐 StudyElite</h2>
        <h1 style="font-size: 52px; letter-spacing: 8px; color: #2563eb;">${otp}</h1>
        <p>This OTP is valid for <strong>5 minutes</strong>.</p>
        <hr>
        <p style="color: #6b7280; font-size: 12px;">StudyElite - Secure Learning Platform</p>
      </div>
    </body>
    </html>
  `;

  // ============ RESEND MODE: ONLY EMAIL ============
  if (resend === true) {
    if (email && process.env.GMAIL_REFRESH_TOKEN) {
      // 🔥 Check email rate limit
      const emailRateCheck = checkEmailRateLimit(identifier);
      rateLimitInfo.email = { remaining: emailRateCheck.remaining, limit: CONFIG.EMAIL_LIMIT };
      
      if (!emailRateCheck.allowed) {
        const resetDate = new Date(emailRateCheck.resetTime);
        return res.status(429).json({
          success: false,
          error: `Email limit reached. You can send ${CONFIG.EMAIL_LIMIT} emails per 24 hours. Reset at ${resetDate.toLocaleString()}`,
          rateLimit: rateLimitInfo
        });
      }
      
      emailResult = await sendEmailViaGmailAPI(email, "🔐 Your OTP Code - StudyElite (Resend)", htmlContent);
      if (emailResult.success) {
        updateResendCooldown(identifier);
      }
    }
  } 
  // ============ NORMAL MODE: SMS FIRST, THEN EMAIL ============
  else {
    // Try SMS
    if (phone) {
      const smsRateCheck = checkSMSRateLimit(identifier);
      rateLimitInfo.sms = { remaining: smsRateCheck.remaining, limit: CONFIG.SMS_LIMIT };
      
      if (smsRateCheck.allowed) {
        smsResult = await sendSMS(phone, otp);
        console.log("📲 SMS:", smsResult.success ? "✅" : "❌");
      } else {
        const resetDate = new Date(smsRateCheck.resetTime);
        console.log(`⚠️ SMS limit reached for ${identifier}`);
        rateLimitInfo.sms.blocked = true;
        rateLimitInfo.sms.resetTime = resetDate;
      }
    }

    // Email fallback if SMS failed (and email available)
    if (!smsResult.success && email && process.env.GMAIL_REFRESH_TOKEN) {
      const emailRateCheck = checkEmailRateLimit(identifier);
      rateLimitInfo.email = { remaining: emailRateCheck.remaining, limit: CONFIG.EMAIL_LIMIT };
      
      if (emailRateCheck.allowed) {
        emailResult = await sendEmailViaGmailAPI(email, "🔐 Your OTP Code - StudyElite", htmlContent);
        console.log("📧 Email:", emailResult.success ? "✅" : "❌");
      } else {
        const resetDate = new Date(emailRateCheck.resetTime);
        console.log(`⚠️ Email limit reached for ${identifier}`);
        rateLimitInfo.email.blocked = true;
        rateLimitInfo.email.resetTime = resetDate;
      }
    }
  }

  const success = (resend ? emailResult.success : (smsResult.success || emailResult.success));

  res.json({
    success,
    sms: smsResult.success,
    email: emailResult.success,
    mode: resend ? "resend" : "normal",
    rateLimit: rateLimitInfo
  });
});

// ============ VERIFY OTP ROUTE ============
router.post("/verify-otp", (req, res) => {
  const { email, phone, otp } = req.body;
  const identifier = phone || email;
  const stored = otpStore.get(identifier);

  if (stored && stored.otp === otp) {
    otpStore.delete(identifier);
    return res.json({ success: true, message: "OTP verified successfully" });
  }
  
  res.json({ success: false, error: "Invalid or expired OTP" });
});

// ============ GET RATE LIMIT STATUS (Optional) ============
router.get("/rate-limit/:identifier", (req, res) => {
  const { identifier } = req.params;
  
  const emailRecord = emailRateStore.get(identifier);
  const smsRecord = smsRateStore.get(identifier);
  
  res.json({
    email: {
      used: emailRecord?.count || 0,
      limit: CONFIG.EMAIL_LIMIT,
      remaining: CONFIG.EMAIL_LIMIT - (emailRecord?.count || 0),
      resetTime: emailRecord ? new Date(emailRecord.firstAttemptTime + CONFIG.WINDOW_MS) : null
    },
    sms: {
      used: smsRecord?.count || 0,
      limit: CONFIG.SMS_LIMIT,
      remaining: CONFIG.SMS_LIMIT - (smsRecord?.count || 0),
      resetTime: smsRecord ? new Date(smsRecord.firstAttemptTime + CONFIG.WINDOW_MS) : null
    }
  });
});

export default router;

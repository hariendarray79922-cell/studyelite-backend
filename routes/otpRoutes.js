// backend/email.js - Full working code
import express from "express";
import fetch from "node-fetch";
import { google } from "googleapis";

const router = express.Router();
const otpStore = new Map();

// ============ GMAIL API SETUP ============
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// Auto-refresh token every 45 minutes
setInterval(async () => {
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    console.log("✅ Gmail API token refreshed");
  } catch (err) {
    console.log("❌ Token refresh failed:", err.message);
  }
}, 45 * 60 * 1000);

// ============ SEND EMAIL VIA GMAIL API ============
async function sendEmailViaGmailAPI(to, subject, htmlContent) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Create email message
    const messageParts = [];
    messageParts.push(`To: ${to}`);
    messageParts.push(`Subject: ${subject}`);
    messageParts.push('Content-Type: text/html; charset=UTF-8');
    messageParts.push('');
    messageParts.push(htmlContent);
    
    const emailMessage = messageParts.join('\r\n');
    
    // Base64 encode
    const encodedMessage = Buffer.from(emailMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    // Send via Gmail API
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });
    
    console.log(`✅ Email sent: ${response.data.id}`);
    return { success: true, messageId: response.data.id };
    
  } catch (err) {
    console.log(`❌ Gmail API error: ${err.message}`);
    return { success: false, error: err.message };
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
    console.log("SMS error:", err.message);
    return false;
  }
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

  if (!phone && !email) {
    return res.json({ success: false, error: "No contact info" });
  }

  // Generate OTP
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

  // Try SMS first
  if (phone) {
    smsSent = await sendSMS(phone, otp);
    console.log("📲 SMS:", smsSent ? "✅" : "❌");
  }

  // If SMS failed or resend, try Email via Gmail API
  if ((!smsSent || resend) && email) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 30px; background: linear-gradient(135deg, #667eea, #764ba2);">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
          <h2 style="color: #4f46e5; margin-bottom: 20px;">🔐 StudyElite</h2>
          <h1 style="font-size: 52px; letter-spacing: 8px; color: #2563eb; background: #f0f0ff; display: inline-block; padding: 15px 30px; border-radius: 12px; margin: 20px 0;">${otp}</h1>
          <p style="color: #4b5563; font-size: 16px;">This OTP is valid for <strong>5 minutes</strong>.</p>
          <hr style="margin: 25px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px;">StudyElite - Secure Learning Platform</p>
        </div>
      </body>
      </html>
    `;
    
    const result = await sendEmailViaGmailAPI(email, "🔐 Your OTP Code - StudyElite", htmlContent);
    emailSent = result.success;
    console.log("📧 Email:", emailSent ? "✅" : "❌");
  }

  res.json({ 
    success: smsSent || emailSent, 
    sms: smsSent, 
    email: emailSent 
  });
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

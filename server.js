import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const otpStore = {};

/* EMAIL OTP SEND */
app.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;

  const otp = Math.floor(1000 + Math.random() * 9000);
  otpStore[email] = otp;

  console.log("EMAIL OTP 👉", otp);

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASS
      }
    });

    await transporter.sendMail({
      from: `"StudyElite" <${process.env.EMAIL}>`,
      to: email,
      subject: "Your OTP Code",
      html: `
        <h2>Your OTP Code</h2>
        <p>Use this code to login:</p>
        <h1 style="letter-spacing:5px;">${otp}</h1>
        <p>This code expires in 5 minutes.</p>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

/* VERIFY */
app.post("/verify-email-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore[email] == otp) {
    delete otpStore[email];
    return res.json({ success: true });
  }

  res.json({ success: false });
});

app.listen(3000, () => console.log("Server running 🚀"));

// ------------------------------------------------------------
// Email service abstraction.
//
// If SMTP_HOST is configured, reset codes are delivered by email
// (nodemailer). If NOT configured, the code is logged server-side
// ONLY and the API always responds with a generic message —
// password reset is explicitly NOT production-ready until SMTP
// credentials are provided. No reset code is ever returned to the
// client in any environment.
// ------------------------------------------------------------
let nodemailer = null;
try {
    // optional dependency: only required when SMTP is configured
    // eslint-disable-next-line global-require
    nodemailer = require("nodemailer");
} catch {
    nodemailer = null;
}

function smtpConfigured() {
    return Boolean(process.env.SMTP_HOST && nodemailer);
}

let transporter = null;
function getTransporter() {
    if (!smtpConfigured()) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined
        });
    }
    return transporter;
}

async function sendResetCode(email, code) {
    if (!smtpConfigured()) {
        // Dev fallback: the code exists server-side but is NEVER sent to the
        // client. Operators can read it from server logs during development.
        console.log(`[mailer] SMTP not configured — reset code for ${email}: ${code}`);
        return { delivered: false };
    }
    const transport = getTransporter();
    await transport.sendMail({
        from: process.env.EMAIL_FROM || "ASCEND <no-reply@localhost>",
        to: email,
        subject: "Your ASCEND password reset code",
        text: `Your ASCEND password reset code is ${code}. It expires in 15 minutes and can be used once. If you did not request this, ignore this email.`,
        html: `<p>Your ASCEND password reset code is <strong>${code}</strong>.</p><p>It expires in 15 minutes and can be used once. If you did not request this, ignore this email.</p>`
    });
    return { delivered: true };
}

module.exports = { sendResetCode, smtpConfigured };

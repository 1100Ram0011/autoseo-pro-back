import {
  sendOutlookMail,
  sendOutlookMailForNewUser,
} from "../config/mailer.js";
import logger from "../config/logger.js";
import { shouldSendEmail } from "./notificationControl.js";
import config from "../config/config.js";

const FOOTER_LOGO_URL =
  "https://dvjoibo2qkfpj.cloudfront.net/logo/Borade+NEW+LOGO+-+PNG+1.png";

const SOCIAL_ICON_IMAGES = {
  x: "https://img.icons8.com/ios-filled/50/ffffff/x.png",
  linkedin: "https://img.icons8.com/ios-filled/50/ffffff/linkedin.png",
  facebook: "https://img.icons8.com/ios-filled/50/ffffff/facebook-new.png",
  instagram: "https://img.icons8.com/ios-filled/50/ffffff/instagram-new.png",
};

const getSocialIconLink = ({ href, label, bgColor, iconUrl }) => `
  <a
    href="${href}"
    aria-label="${label}"
    title="${label}"
    style="
      display: inline-block;
      width: 38px;
      height: 38px;
      margin: 0 5px;
      border-radius: 50%;
      background-color: ${bgColor};
      text-align: center;
      text-decoration: none;
    "
  >
    <img 
      src="${iconUrl}" 
      alt="${label}" 
      width="18" 
      height="18" 
      style="width: 18px; height: 18px; margin-top: 10px; border: none; outline: none; display: inline-block; color: #ffffff;"
    />
  </a>
`;

const getFooterHtml = () => `
  <div style="background-color: #333; padding: 20px; text-align: center; color: white; border-radius: 0 0 10px 10px;">
      <img
        src="${FOOTER_LOGO_URL}"
        alt="BoradeAI Logo"
        style="width: 120px; margin: 0 auto 12px; display: block;"
      >
      <p style="margin: 0 0 16px; font-size: 14px; color: #ccc;">Copyright &copy; ${new Date().getFullYear()} BoradeAI, All rights reserved.</p>
      
      <div style="margin-bottom: 15px;">
          ${getSocialIconLink({
  href: "https://x.com/BoradeAI",
  label: "X",
  bgColor: "#111111",
  iconUrl: SOCIAL_ICON_IMAGES.x,
})}
          ${getSocialIconLink({
  href: "https://www.linkedin.com/company/o4a-tech",
  label: "LinkedIn",
  bgColor: "#0A66C2",
  iconUrl: SOCIAL_ICON_IMAGES.linkedin,
})}
          ${getSocialIconLink({
  href: "https://www.facebook.com/profile.php?id=61588621029409",
  label: "Facebook",
  bgColor: "#1877F2",
  iconUrl: SOCIAL_ICON_IMAGES.facebook,
})}
          ${getSocialIconLink({
  href: "https://www.instagram.com/borade.ai/",
  label: "Instagram",
  bgColor: "#E4405F",
  iconUrl: SOCIAL_ICON_IMAGES.instagram,
})}
      </div>
      
      <p style="margin: 0; font-size: 12px;">
          <a href="https://www.borade.ai/" style="color: #4da6ff; text-decoration: none;">www.borade.ai</a>
      </p>
  </div>
`;

// const getEmailTemplate = (content) => `
// <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.05);">
//     <div style="padding: 30px; text-align: center; background-color: #fff; border-radius: 10px 10px 0 0;">
//         <img src="${FOOTER_LOGO_URL}" alt="BoradeAI Logo" style="width: 150px; margin-bottom: 20px;">
//         <div style="text-align: left; color: #333; line-height: 1.6;">
//             ${content}
//         </div>
//     </div>
//     ${getFooterHtml()}
// </div>
// `;

const getEmailTemplate = (content) => `
<table width="100%" bgcolor="#f4f6f8" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      <table width="600" bgcolor="#ffffff" cellpadding="20" cellspacing="0" style="border-radius:10px;">
        <tr>
          <td align="center">
            <img src="${FOOTER_LOGO_URL}" width="140" />
          </td>
        </tr>
        <tr>
          <td style="font-family: Arial; color:#333;">
            ${content}
          </td>
        </tr>
      </table>
      ${getFooterHtml()}
    </td>
  </tr>
</table>
`;

export const sendLoginEmailOTP = async (to, otp) => {
  logger.info(to, otp);

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const expiryTime = "5";

  const subject = "Your BoradeAI Sign-In OTP";
  const content = `
    <p>We received a request to sign in to your BoradeAI account.</p>
    <p>Your One-Time Password (OTP) is:</p>
    <h2 style="text-align: center; color: #2E86C1; letter-spacing: 5px; font-size: 32px; margin: 20px 0;">${otp}</h2>
    <p>This OTP is valid for <b>${expiryTime} minutes</b>.</p>
    <p>For your security, please do not share this code with anyone.</p>
    <p>If you did not request this login, please ignore this email or contact our support team immediately.</p>
    <br/>
    <p>Best regards,</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Login OTP email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendBusinessVerificationOTP = async (to, otp) => {
  logger.info(to, otp);

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const expiryTime = "5";

  const subject = "Verify Your Business Email – BoradeAI";
  const content = `
    <p>We received a request to verify your business email address for your BoradeAI account.</p>
    <p>Your One-Time Password (OTP) is:</p>
    <h2 style="text-align: center; color: #2E86C1; letter-spacing: 5px; font-size: 32px; margin: 20px 0;">${otp}</h2>
    <p>This OTP is valid for <b>${expiryTime} minutes</b>.</p>
    <p>Once verified, we will begin analysing your website to generate your business profile.</p>
    <p>For your security, please do not share this code with anyone.</p>
    <p>If you did not request this verification, please ignore this email or contact our support team immediately.</p>
    <br/>
    <p>Best regards,</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Business verification OTP email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Business verification email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendRegisterEmailOTP = async (to, name, otp) => {
  logger.info(to, otp);
  const userName = name || "User";

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const expiryTime = "5";

  const subject = "Your BoradeAI Sign-Up OTP";
  const content = `
    <p>Thank you for signing up with BoradeAI.</p>
    <p>To complete your registration, please use the following One-Time Password (OTP):</p>
    <h2 style="text-align: center; color: #2E86C1; letter-spacing: 5px; font-size: 32px; margin: 20px 0;">${otp}</h2>
    <p>This OTP is valid for <b>${expiryTime} minutes</b>.</p>
    <p>For security reasons, please do not share this code with anyone.</p>
    <p>If you did not initiate this sign-up request, please ignore this email or contact our support team immediately.</p>
    <br/>
    <p>Welcome aboard!</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Register OTP email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendEmailConsentLink = async (to, link) => {
  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }
  const subject = "Consent Verification – Action Required";
  const content = `
      <h2>Consent Verification Required</h2>
      <p>To proceed with your verification process, we need your consent.</p>

      <p>Please click the link below to approve and provide your consent:</p>

      <div style="text-align: center; margin: 25px 0;">
        <a href="${link}" 
           style="display:inline-block; padding:12px 24px; background:#2E86C1; color:#fff; 
                  text-decoration:none; border-radius:5px; font-size:16px; font-weight: bold;">
          Provide Consent
        </a>
      </div>

      <p style="margin-top:20px;">If you did not request this, you can safely ignore this email.</p>

      <p>Thank you,<br><b>BoradeAI Team</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Consent email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Consent email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendInvoiceEmailByService = async ({
  to,
  invoiceNumber,
  invoiceDate,
  invoiceAmount,
  pdfUrl,
  clientName,
  pdfBuffer,
}) => {
  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const subject = `Tax Invoice ${invoiceNumber} | O4A Technologies Pvt. Ltd`;

  const content = `
  
    <!-- TITLE -->
    <h2 style="margin:10px 0 20px; text-align:center; color:#1f2d3d;">
      Tax Invoice
    </h2>

    <!-- GREETING -->
    <p style="font-size:14px; color:#333;">
      Dear <b>${clientName}</b>,
    </p>

    <p style="font-size:14px; color:#333;">
      Thank you for choosing <b>BoradeAI</b>.
      Please find your tax invoice details below.
    </p>

    <!-- INVOICE SUMMARY CARD -->
    <div style="
      border:1px solid #e0e0e0;
      border-radius:6px;
      padding:15px;
      margin:20px 0;
      background:#fafafa;
    ">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr>
          <td style="padding:6px 0; color:#555;">Invoice Number</td>
          <td style="padding:6px 0; text-align:right; font-weight:bold;">
            ${invoiceNumber}
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0; color:#555;">Invoice Date</td>
          <td style="padding:6px 0; text-align:right;">
            ${invoiceDate}
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0; color:#555;">Total Amount</td>
          <td style="padding:6px 0; text-align:right; font-weight:bold;">
            ${invoiceAmount}
          </td>
        </tr>
      </table>
    </div>

    <!-- SUPPORT -->
    <p style="font-size:14px; color:#333;">If you have any questions regarding this invoice, please contact us at <a href="mailto:info@borade.ai" style="color:#0a58ca;">info@borade.ai</a></p>

    <!-- SIGNATURE -->
    <p style="font-size:14px; color:#333; margin-top:25px;">
      Regards,<br>
      <b>Team BoradeAI</b>
    </p>

    <!-- FOOTER -->
    <hr style="border:none; border-top:1px solid #e0e0e0; margin:25px 0;">

    <p style="font-size:11px; color:#777; text-align:center;">
      This is a system-generated email. Please do not reply to this message.
    </p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [
    {
      filename: `Invoice_${invoiceNumber || "file"}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
  ];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });

    logger.info(`Invoice email sent to ${to} | ${invoiceNumber}`);
    return { success: true };
  } catch (error) {
    logger.error("Invoice email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendEmailToReference = async (
  to,
  link,
  role,
  employeeName,
  name,
) => {
  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }
  const subject = `Action Required: Submit Employment Feedback for ${employeeName}`;
  const content = `
 <p>Dear <strong>${name}</strong>,</p>
 <p>Greetings.</p>

     <p>
  <strong>${employeeName}</strong> has mentioned you as their
 <strong>${role === "manager"
      ? "Manager"
      : role === "hr"
        ? "HR"
        : role === "colleague1" || role === "colleague2"
          ? "Colleague"
          : role === "allinone"
            ? "Manager / HR"
            : "Professional Contact"
    }</strong>
contact for employment verification through <strong>BoradeAI</strong>.
</p>

      <p>We request you to submit brief employment feedback by clicking the link below. The process is secure and will take only a few minutes.</p>
      <p>Your input will help the employee move forward confidently in their next career opportunity.</p>
      <p>Please click the link below to submit feedback:</p>
      
      <div style="text-align: center; margin: 25px 0;">
      <a href="${link}" 
      style="display:inline-block; padding:12px 24px; background:#2E86C1; color:#fff; 
      text-decoration:none; border-radius:5px; font-size:16px; font-weight: bold;">
      Submit Feedback
      </a>
      </div>
      
      <p>About BoradeAI:</p>
      <p>BoradeAI is a secure Digital Background Verification Platform that helps employers and professionals complete verifications quickly and transparently.</p>
    
      <p>Thank you for your time and support,<br>
      <p>Warm regards,<br>
      Team BoradeAI<br>
      Background Verification Platform<br>
      <a href="https://ai.mytek.in">https://ai.mytek.in</a><br>
      <a href="tel:+918008003197">+91 800 800 3197</a></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Reference email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Reference email sending failed:", error);
    return { success: false, error: error.message };
  }
};

// POC Email
// Send POC invite email
export const sendPocInviteEmail = async (to, name, inviteLink) => {
  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const subject = "Welcome as Point of Contact (POC)";
  const content = `
    <h2 style="color: #19649D;">Hello ${name},</h2>
    <p>
      You have been added as a <b>Point of Contact</b> for your organization on 
      <b>BoradeAI Verification Platform</b>.
    </p>

    <p>
      Please click the link below to activate your POC account:
    </p>

    <div style="text-align: center; margin: 25px 0;">
      <a 
        href="${inviteLink}" 
        style="display: inline-block; background: #19649D; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;"
      >
        Verify & Activate Account
      </a>
    </div>

    <p style="margin-top: 20px;">
      If you didn’t expect this invitation, you can ignore this email.
    </p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send POC invite:", error);
    return { success: false, error: error.message };
  }
};

export const sendNewOrgNotificationEmail = async (orgDetails) => {
  if (!shouldSendEmail()) {
    logger.info(
      `[Email Skipped] Email sending is disabled. New Org Notification.`,
    );
    return { success: true, message: "Email skipped" };
  }

  const to = "info@borade.ai";
  const subject = `New Organization Registration: ${orgDetails.businessName}`;

  const content = `
    <h2 style="color: #19649D; margin-bottom: 20px;">New Organization Registered</h2>
    <p style="font-size: 16px; color: #333;">A new organization has successfully completed registration on the <b>BoradeAI Platform</b>.</p>
    <div style="margin-top: 25px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; width: 40%; color: #555;"><strong>Organization Name</strong></td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #333; font-weight: bold;">${orgDetails.businessName}</td>
        </tr>
        <tr>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #555;"><strong>GST Number</strong></td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #333;">${orgDetails.gstNumber}</td>
        </tr>
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #555;"><strong>Email</strong></td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #333;">${orgDetails.email}</td>
        </tr>
        <tr>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #555;"><strong>Mobile</strong></td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #333;">${orgDetails.mobile}</td>
        </tr>
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #555;"><strong>Address</strong></td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #eee; color: #333;">${orgDetails.address}</td>
        </tr>
         <tr>
          <td style="padding: 12px 15px; color: #555;"><strong>Registered At</strong></td>
          <td style="padding: 12px 15px; color: #333;">${new Date().toLocaleString()}</td>
        </tr>
      </table>
    </div>

    <p style="margin-top: 25px; color: #888; font-size: 13px; text-align: center;">This is an automated system notification.</p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`New Org Notification sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("New Org Notification Email failed:", error);
    return { success: false, error: error.message };
  }
};

export const buildEmployeeServiceSummary = (transaction) => {
  const employees = transaction?.cartSnapshot?.employees || [];

  const employeeLines = employees.map((emp) => {
    const services = (emp.services || [])
      .filter((s) => !s.isDeleted)
      .map((s) => `${s.serviceName} (₹${s.price})`)
      .join(", ");

    return {
      empName: emp.empName,
      services,
    };
  });

  const servicesAmount = Number(
    transaction?.servicesAmt ?? transaction?.cartSnapshot?.servicesAmt ?? 0,
  );

  const walletTopupAmount = Number(transaction?.walletTopupAmount ?? 0);

  const hasServices = servicesAmount > 0;
  const hasWalletTopup = walletTopupAmount > 0;

  const isWalletOnly = hasWalletTopup && !hasServices;
  const isCombinedPayment = hasWalletTopup && hasServices;

  let payableAmount = 0;

  if (isCombinedPayment) {
    payableAmount = servicesAmount + walletTopupAmount;
  } else if (isWalletOnly) {
    payableAmount = walletTopupAmount;
  } else {
    payableAmount = Number(
      transaction?.totalAmt ??
      transaction?.cartSnapshot?.grandTotal ??
      servicesAmount,
    );
  }

  return {
    isWalletTopup: isWalletOnly,
    isCombinedPayment,
    employeeCount: employees.length,
    employeeLines,
    servicesAmount,
    walletTopupAmount,
    payableAmount,
    expiry: transaction?.paymentLinkUrl?.expiresAt,
  };
};

export const sendPaymentLinkCashfreeEmail = async ({
  to,
  transaction,
  fromName = "BoradeAI",
  initiatedByText,
  organizationName,
  organizationEmail,
  supportEmail = config.EMAIL_USER,
  QRCodeImage,
}) => {
  if (!shouldSendEmail()) {
    logger.info("[Email Skipped] Payment Link Email disabled");
    return { success: true, message: "Email skipped" };
  }

  const {
    isWalletTopup,
    employeeCount,
    servicesAmount = 0,
    walletTopupAmount = 0,
    payableAmount,
    expiry,
  } = buildEmployeeServiceSummary(transaction);

  const hasWalletTopup = walletTopupAmount > 0;
  const hasServices = servicesAmount > 0;
  const isCombinedPayment = hasWalletTopup && hasServices;

  const paymentLink = transaction?.paymentLinkUrl?.url;
  const referenceId = transaction?.paymentLinkUrl?.linkId;

  /* ---------- Subject ---------- */
  const subject = isCombinedPayment
    ? `${fromName} | Payment Request (Wallet + Services) from ${organizationName}`
    : isWalletTopup
      ? `${fromName} | Wallet Top-Up Request from ${organizationName}`
      : `${fromName} | Payment Request from ${organizationName}`;

  /* ---------- Heading & Description ---------- */
  const heading = isCombinedPayment
    ? "Payment Request Generated"
    : isWalletTopup
      ? "Wallet Top-Up Request Generated"
      : "Payment Request Generated";

  const description = isCombinedPayment
    ? "A combined payment has been initiated for wallet top-up and background verification services."
    : isWalletTopup
      ? "A wallet top-up payment has been initiated on the platform."
      : "A secure payment link has been generated for background verification services.";

  /* ---------- Dynamic Rows ---------- */
  const serviceRow = hasServices
    ? `
      <tr style="background:#f8f9fa;">
        <td style="padding:12px 15px; color:#555;"><strong>Services</strong></td>
        <td style="padding:12px 15px; color:#333;">
          Background Verification – ${employeeCount} Employee(s)
          <br/><strong>₹${servicesAmount}</strong>
        </td>
      </tr>
    `
    : "";

  const walletRow = hasWalletTopup
    ? `
      <tr>
        <td style="padding:12px 15px; color:#555;"><strong>Wallet Top-Up</strong></td>
        <td style="padding:12px 15px; color:#333;">
          ₹${walletTopupAmount}
        </td>
      </tr>
    `
    : "";

  /* ---------- CTA ---------- */
  const ctaText = isCombinedPayment
    ? `Pay INR ${payableAmount}.00`
    : isWalletTopup
      ? `Add ₹${walletTopupAmount} to Wallet`
      : `Pay INR ${payableAmount}.00`;

  /* ---------- Email Content ---------- */
  const content = `
    <h2 style="color:#19649D; margin-bottom:20px;">
      ${heading}
    </h2>

    <p style="font-size:15px; color:#333; line-height:1.6;">
      ${initiatedByText}
      ${description}
      This payment is being processed securely via <strong>${fromName}</strong>.
    </p>

    <div style="background:#eef3ff; padding:18px; border-radius:8px; margin:24px 0; text-align:center;">
      <p style="margin:0; font-size:14px; color:#555;">Total Amount Payable</p>
      <p style="margin:6px 0 0; font-size:28px; font-weight:700; color:#19649D;">
        INR ${payableAmount}.00
      </p>
    </div>

    ${QRCodeImage
      ? `
          <div style="text-align:center; margin:20px 0 10px;">
            <p style="font-size:13px; color:#555;">scan the QR code to proceed</p>
            <img src="${QRCodeImage}" width="160" height="160"
              style="border:1px solid #e0e0e0; border-radius:8px; padding:8px;" />
          </div>
        `
      : ""
    }

    <div style="border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr style="background:#f8f9fa;">
          <td style="padding:12px 15px; width:40%; color:#555;"><strong>Organization</strong></td>
          <td style="padding:12px 15px; color:#333; font-weight:600;">
            ${organizationName}
          </td>
        </tr>

        ${serviceRow}
        ${walletRow}

        <tr>
          <td style="padding:12px 15px; color:#555;"><strong>Reference ID</strong></td>
          <td style="padding:12px 15px; color:#333;">${referenceId}</td>
        </tr>

        <tr style="background:#f8f9fa;">
          <td style="padding:12px 15px; color:#555;"><strong>Link Expiry</strong></td>
          <td style="padding:12px 15px; color:#333;">
            ${new Date(expiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (IST)
          </td>
        </tr>
      </table>
    </div>

    <div style="text-align:center; margin:30px 0;">
      <a href="${paymentLink}"
        style="background:#19649D; color:#fff; padding:14px 34px; font-size:16px; font-weight:600; border-radius:8px; text-decoration:none;">
        ${ctaText}
      </a>
    </div>



    <p style="font-size:13px; color:#666;">
      Service queries: <a href="mailto:${organizationEmail}">${organizationEmail}</a><br/>
      Payment support: <a href="mailto:${supportEmail}">${supportEmail}</a>
    </p>

    <p style="margin-top:25px; color:#888; font-size:13px; text-align:center;">
      This is an automated system notification.
    </p>
  `;

  const htmlBody = getEmailTemplate(content);

  try {
    await sendOutlookMail({ to, subject, htmlBody, attachments: [] });
    logger.info(`Payment Email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Payment email failed:", error);
    return { success: false, error: error.message };
  }
};

// Email for delete org data
export const sendDeleteOrganizationOTPEmail = async (
  to,
  organizationName,
  otp,
) => {
  logger.info(to, otp);

  const orgName = organizationName || "Your Organization";

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const expiryTime = "1";

  const subject = "BoradeAI | Confirm Organization Deletion (OTP Required)";

  const content = `
    <p>This is a <b>critical security confirmation</b> for your BoradeAI account.</p>

    <p>You have requested to <b>permanently erase all data</b> associated with the organization:</p>

    <p style="text-align:center; font-size:16px; font-weight:bold;">
      ${orgName}
    </p>

    <p>Please use the following One-Time Password (OTP) to confirm this action:</p>

    <h2 style="
      text-align: center;
      color: #C0392B;
      letter-spacing: 6px;
      font-size: 32px;
      margin: 20px 0;
    ">
      ${otp}
    </h2>

    <p>
      This OTP is valid for <b>${expiryTime} minutes</b>.
    </p>

    <p style="color:#C0392B;">
      <b>Warning:</b> This action is irreversible. Once confirmed, all organization data,
      employees, transactions, reports, and related records will be permanently deleted.
    </p>

    <p>
      If you did <b>not</b> initiate this request, please ignore this email and contact
      BoradeAI support immediately.
    </p>

    <br/>

    <p>Regards,</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });

    logger.info(`Delete Organization OTP email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Delete Organization OTP email failed:", error);
    return { success: false, error: error.message };
  }
};

// response to token errors on email

export const sendResponseApiErrors = async (to, errorDetails) => {
  logger.info(to, errorDetails);

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const { statusCode, errorMessage, endpoint, timestamp } = errorDetails;

  const subject = `BoradeAI API Error Alert - ${statusCode}`;
  const content = `
    <p>An API error has been detected in your BoradeAI application.</p>
    <p>Here are the error details:</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr style="background-color: #f8d7da;">
        <td style="padding: 10px; border: 1px solid #f5c6cb; font-weight: bold; width: 40%;">Status Code</td>
        <td style="padding: 10px; border: 1px solid #f5c6cb; color: #721c24;">
          <h2 style="margin: 0; font-size: 28px; letter-spacing: 3px;">${statusCode}</h2>
        </td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #dee2e6; font-weight: bold;">Error Message</td>
        <td style="padding: 10px; border: 1px solid #dee2e6; color: #333;">${errorMessage}</td>
      </tr>
      <tr style="background-color: #f8d7da;">
        <td style="padding: 10px; border: 1px solid #f5c6cb; font-weight: bold;">Endpoint</td>
        <td style="padding: 10px; border: 1px solid #f5c6cb; color: #721c24;">${endpoint}</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #dee2e6; font-weight: bold;">Timestamp</td>
        <td style="padding: 10px; border: 1px solid #dee2e6;">${timestamp}</td>
      </tr>
    </table>

    <p style="color: #856404; background-color: #fff3cd; padding: 10px; border-radius: 4px;">
      ⚠️ Please investigate this error and take necessary action.
    </p>
    <p>If this error persists, please contact the development team immediately.</p>
    <br/>
    <p>Best regards,</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`API error notification email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Email sending failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendNewUserNotificationEmail = async (userDetails) => {
  if (!shouldSendEmail() || config.NODE_ENV === "development") {
    logger.info(
      `[Email Skipped] Email sending is disabled.New User Notification.`,
    );
    return { success: true, message: "Email skipped" };
  }

  // Multiple recipients
  const to = ["mahesh@mytek.in"];

  const subject = `New User Registration in Borade AI : ${userDetails.name}`;

  const content = `
    <b>
      New User Registered
    </b>
<br />
<p style="font-size:16px;color:#333;font-family:Arial,Helvetica,sans-serif;">
  A new user has successfully registered on the <b>BoradeAI Platform</b>.
</p>

<div style="margin-top:25px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Arial,Helvetica,sans-serif;">

    <tr style="background-color:#f8f9fa;">
      <td style="padding:12px 15px;border-bottom:1px solid #eee;width:40%;color:#555;">
        <strong>Name</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;font-weight:bold;">
        ${userDetails.name || "-"}
      </td>
    </tr>

    <tr>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>Email</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.email || "-"}
      </td>
    </tr>

    <tr style="background-color:#f8f9fa;">
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>Mobile</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.phone || "-"}
      </td>
    </tr>

    <tr>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>GST Number</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.gstNumber || "Not Available"}
      </td>
    </tr>

    <tr style="background-color:#f8f9fa;">
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>Address</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.address || "Not Available"}
      </td>
    </tr>

    <tr>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>District</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.district || "Not Available"}
      </td>
    </tr>

    <tr style="background-color:#f8f9fa;">
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>State</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.state || "Not Available"}
      </td>
    </tr>

    <tr>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>Pincode</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.pincode || "Not Available"}
      </td>
    </tr>

    <tr style="background-color:#f8f9fa;">
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#555;">
        <strong>Domain Type</strong>
      </td>
      <td style="padding:12px 15px;border-bottom:1px solid #eee;color:#333;">
        ${userDetails.domainType || "Not Available"}
      </td>
    </tr>

    <tr>
      <td style="padding:12px 15px;color:#555;">
        <strong>Registered At</strong>
      </td>
      <td style="padding:12px 15px;color:#333;">
        ${userDetails.createdAt
      ? new Date(userDetails.createdAt).toLocaleString()
      : new Date().toLocaleString()
    }
      </td>
    </tr>

  </table>
</div>

<p style="margin-top:25px;color:#888;font-size:13px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
  This is an automated system notification from <b>BoradeAI</b>.
</p>
`;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  const emailData = {
    to,
    subject,
    htmlBody,
    attachments,
  };

  try {
    await sendOutlookMailForNewUser(emailData);

    logger.info(`New User Notification sent to ${to.join(", ")} `);
    return { success: true };
  } catch (error) {
    logger.error("New User Notification Email failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendThirdPartyApiErrorEmail = async (
  userDetails = {},
  errorDetails = {},
) => {
  if (!shouldSendEmail()) {
    logger.info(
      `[Email Skipped] Email sending is disabled. Error notification skipped.`,
    );
    return { success: true, message: "Email skipped" };
  }

  const { jobId, userId, message } = errorDetails;

  console.error("🔥 Worker Error:", {
    jobId,
    userId,
    message,
  });

  const to = ["mahesh@mytek.in"];

  const subject = `🚨 BoradeAI Worker Error Alert`;

  const content = `

<h2 style="color:#d9534f;font-family:Arial,Helvetica,sans-serif;">
Third Party API / Worker Error
</h2>

<p style="font-size:15px;color:#444;font-family:Arial,Helvetica,sans-serif;">
An error occurred while processing a background worker or third-party API request in 
<b>BoradeAI</b>.
</p>

<!-- ERROR DETAILS -->
<div style="margin-top:20px;border:1px solid #ffd6d6;border-radius:8px;overflow:hidden;">
<table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Arial,Helvetica,sans-serif;">

<tr style="background:#fff5f5;">
<td style="padding:12px;border-bottom:1px solid #eee;width:40%;color:#555;">
<strong>Job ID</strong>
</td>
<td style="padding:12px;border-bottom:1px solid #eee;">
${jobId || "-"}
</td>
</tr>

<tr>
<td style="padding:12px;border-bottom:1px solid #eee;color:#555;">
<strong>User ID</strong>
</td>
<td style="padding:12px;border-bottom:1px solid #eee;">
${userId || "-"}
</td>
</tr>

<tr style="background:#fff5f5;">
<td style="padding:12px;color:#555;">
<strong>Error Message</strong>
</td>
<td style="padding:12px;color:#d9534f;font-weight:bold;">
${message || "Unknown Error"}
</td>
</tr>

</table>
</div>


<!-- USER CONTEXT -->
<div style="margin-top:30px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
<table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Arial,Helvetica,sans-serif;">

<tr style="background:#f8f9fa;">
<td style="padding:12px;border-bottom:1px solid #eee;width:40%;color:#555;">
<strong>User Name</strong>
</td>
<td style="padding:12px;border-bottom:1px solid #eee;">
${userDetails.name || "-"}
</td>
</tr>

<tr>
<td style="padding:12px;border-bottom:1px solid #eee;color:#555;">
<strong>Email</strong>
</td>
<td style="padding:12px;border-bottom:1px solid #eee;">
${userDetails.email || "-"}
</td>
</tr>

<tr style="background:#f8f9fa;">
<td style="padding:12px;color:#555;">
<strong>Mobile</strong>
</td>
<td style="padding:12px;">
${userDetails.phone || "-"}
</td>
</tr>

</table>
</div>


<p style="margin-top:25px;color:#888;font-size:13px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
This is an automated error alert from <b>BoradeAI Monitoring System</b>.
</p>

`;

  const htmlBody = getEmailTemplate(content);

  const emailData = {
    to,
    subject,
    htmlBody,
    attachments: [],
  };

  try {
    await sendOutlookMailForNewUser(emailData);

    logger.info(`Worker error notification sent to ${to.join(", ")}`);
    return { success: true };
  } catch (error) {
    logger.error("Worker Error Email failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendDeleteAccountOTPEmail = async (to, otp) => {
  logger.info(to, otp);

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const expiryTime = "1";

  const subject = "BoradeAI | Confirm Organization Deletion (OTP Required)";

  const content = `
    <p>This is a <b>critical security confirmation</b> for your BoradeAI account.</p>

    <p>You have requested to <b>permanently erase all data</b> associated with the organization:</p>


    <p>Please use the following One-Time Password (OTP) to confirm this action:</p>

    <h2 style="
      text-align: center;
      color: #C0392B;
      letter-spacing: 6px;
      font-size: 32px;
      margin: 20px 0;
    ">
      ${otp}
    </h2>

    <p style="color:#C0392B;">
      <b>Warning:</b> This action is irreversible. Once confirmed, all organization data,
      employees, transactions, reports, and related records will be permanently deleted.
    </p>

    <p>
      If you did <b>not</b> initiate this request, please ignore this email and contact
      BoradeAI support immediately.
    </p>

    <br/>

    <p>Regards,</p>
    <p><b>Team BoradeAI</b></p>
  `;

  const htmlBody = getEmailTemplate(content);
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });

    logger.info(`Delete Organization OTP email sent to ${to}`);
    return { success: true };
  } catch (error) {
    logger.error("Delete Organization OTP email failed:", error);
    return { success: false, error: error.message };
  }
};

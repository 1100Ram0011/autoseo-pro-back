import { sendOutlookMail } from "../config/mailer.js";
import logger from "../config/logger.js";
import { shouldSendEmail } from "./notificationControl.js";

const FOOTER_LOGO_URL = "https://dvjoibo2qkfpj.cloudfront.net/logo/Group+4617.png";
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
            href: "https://www.linkedin.com/company/BoradeAI",
            label: "LinkedIn",
            bgColor: "#22486eff",
            iconUrl: SOCIAL_ICON_IMAGES.linkedin,
          })}
          ${getSocialIconLink({
            href: "https://www.facebook.com/people/Borade-AI/61588621029409/",
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

const getEmailTemplate = (content) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.05);">
    <div style="padding: 30px; text-align: center; background-color: #fff; border-radius: 10px 10px 0 0;">
        <img src="${FOOTER_LOGO_URL}" alt="BoradeAI Logo" style="width: 150px; margin-bottom: 20px;">
        <div style="text-align: left; color: #333; line-height: 1.6;">
            ${content}
        </div>
    </div>
    ${getFooterHtml()}
</div>
`;

export const sendMeetingConfirmationEmail = async ({
  to,
  name,
  phone,
  date,
  timeSlot,
  meetingId,
  meetLink,
}) => {
  logger.info(to, { name, date, timeSlot, meetLink });

  if (!shouldSendEmail()) {
    logger.info(`[Email Skipped] Email sending is disabled. To: ${to}`);
    return { success: true, message: "Email skipped" };
  }

  const subject = "Meeting Confirmation - BoradeAI";
  
  // Format date for better readability
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
    <h2 style="color: #19649D; margin-bottom: 20px;">Meeting Confirmation</h2>
    
    <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
      Dear <strong>${name}</strong>,
    </p>
    
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      Thank you for scheduling a meeting with BoradeAI. Your meeting has been successfully confirmed.
      We're looking forward to discussing how we can help you with your business needs.
    </p>

    <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #19649D; margin-top: 0; margin-bottom: 15px; font-size: 18px;">Meeting Details</h3>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="border-bottom: 1px solid #dee2e6;">
          <td style="padding: 10px 0; color: #555; width: 120px;"><strong>Date</strong></td>
          <td style="padding: 10px 0; color: #333; font-weight: 500;">${formattedDate}</td>
        </tr>
        <tr style="border-bottom: 1px solid #dee2e6;">
          <td style="padding: 10px 0; color: #555;"><strong>Time</strong></td>
          <td style="padding: 10px 0; color: #333; font-weight: 500;">${timeSlot}</td>
        </tr>
        ${phone ? `
        <tr>
          <td style="padding: 10px 0; color: #555;"><strong>Contact</strong></td>
          <td style="padding: 10px 0; color: #333; font-weight: 500;">${phone}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    ${meetLink ? `
    <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0;">
      <h4 style="color: #155724; margin-top: 0; margin-bottom: 15px; font-size: 16px;">🎥 Google Meet Link</h4>
      <p style="margin: 0 0 15px; color: #155724; font-size: 15px; line-height: 1.6;">
        Your meeting will be held via Google Meet. You can join using the link below:
      </p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${meetLink}" 
           target="_blank"
           style="display: inline-block; background: #4285f4; color: #fff; text-decoration: none; 
                  padding: 15px 30px; border-radius: 8px; font-size: 16px; font-weight: bold;">
          Join Google Meet
        </a>
      </div>
      <p style="margin: 15px 0 0; color: #155724; font-size: 14px; line-height: 1.5;">
        <strong>Meeting Link:</strong> <a href="${meetLink}" style="color: #19649D;">${meetLink}</a>
      </p>
      <p style="margin: 5px 0 0; color: #6c757d; font-size: 13px;">
        💡 <em>Click the button above or copy the link to join your meeting. The link will be active at the scheduled time.</em>
      </p>
    </div>
    ` : ''}

    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
        <strong>Important:</strong> This meeting will be held virtually via Google Meet. 
        Please ensure you have a stable internet connection and a working microphone/camera.
      </p>
    </div>

    <p style="font-size: 15px; color: #333; margin-top: 25px;">
      If you need to reschedule or have any questions before the meeting, please feel free to contact us.
    </p>

    <p style="font-size: 15px; color: #333; margin-top: 20px;">
      We look forward to speaking with you!
    </p>

    <p style="font-size: 15px; color: #333; margin-top: 20px;">
      Best regards,<br>
      <strong>Team BoradeAI</strong>
    </p>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
      <p style="font-size: 13px; color: #6c757d; margin: 0;">
        <strong>Contact Information:</strong><br>
        Email: <a href="mailto:info@borade.ai" style="color: #19649D;">info@borade.ai</a><br>
        Phone: <a href="tel:+91 70 8773 8773" style="color: #19649D;">+91 70 8773 8773</a><br>
        Website: <a href="https://www.borade.ai" style="color: #19649D;">www.borade.ai</a>
      </p>
    </div>
  `;

  const htmlBody = getEmailTemplate(content);
  
  // Debug: Log the content before sending
  logger.info('Email content length:', content?.length || 0);
  logger.info('Email content preview:', content?.substring(0, 200) + '...' || 'NO CONTENT');
  
  // If content is empty, use fallback
  if (!content || content.trim().length === 0) {
    logger.error('Email content is empty! Using fallback template.');
    content = `
      <h2 style="color: #19649D; margin-bottom: 20px;">Meeting Confirmation</h2>
      <p>Dear ${name},</p>
      <p>Your meeting has been scheduled successfully.</p>
      <p><strong>Date:</strong> ${formattedDate}</p>
      <p><strong>Time:</strong> ${timeSlot}</p>
      ${meetLink ? `<p><strong>Google Meet:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ''}
      <p>Best regards,<br>Team BoradeAI</p>
    `;
  }
  
  const attachments = [];

  try {
    await sendOutlookMail({
      to,
      subject,
      htmlBody,
      attachments,
    });
    logger.info(`Meeting confirmation email sent to ${to} for meeting on ${date} at ${timeSlot}`);
    return { success: true };
  } catch (error) {
    logger.error("Meeting confirmation email sending failed:", error);
    return { success: false, error: error.message };
  }
};

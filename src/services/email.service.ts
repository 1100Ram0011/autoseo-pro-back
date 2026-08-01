import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path: string }[];
}

export const sendEmail = async (options: EmailOptions) => {
  // Use SMTP transporter based on environment variables
  // By default, assuming a simple SMTP or ethereal for testing
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || '"AutoSEO Pro" <reports@autoseopro.com>',
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: options.attachments,
  };

  try {
    // Email sending is currently disabled as per user request
    // const info = await transporter.sendMail(mailOptions);
    // console.log('Message sent: %s', info.messageId);
    console.log('Email system is disabled. Would have sent email to:', options.to);
    return { messageId: 'disabled' };
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

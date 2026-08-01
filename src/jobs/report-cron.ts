import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { generateReportPDF } from '../services/pdf.service';
import { sendEmail } from '../services/email.service';
import path from 'path';

const prisma = new PrismaClient();

// This cron job runs every day at 8:00 AM
// "0 8 * * *"
export const initReportCron = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log('Running scheduled reports check at 8:00 AM');
    
    try {
      // Find all active scheduled reports
      const activeSchedules = await prisma.reportSchedule.findMany({
        where: { status: 'Active' },
        include: { site: true }
      });

      for (const schedule of activeSchedules) {
        try {
          console.log(`Generating scheduled report: ${schedule.name} for site: ${schedule.site.url}`);
          
          // Generate PDF using Puppeteer
          const pdfPath = await generateReportPDF(schedule.siteId, schedule.frequency, schedule.name);
          const fullPdfPath = path.join(process.cwd(), pdfPath);

          // Send Email
          await sendEmail({
            to: schedule.emails,
            subject: `Your ${schedule.frequency} SEO Report for ${schedule.site.url}`,
            text: `Hello,\n\nPlease find attached your ${schedule.frequency.toLowerCase()} SEO report for ${schedule.site.url}.\n\nBest,\nAutoSEO Pro Team`,
            html: `
              <div style="font-family: sans-serif; color: #333;">
                <h2>Your SEO Report is Ready!</h2>
                <p>Hello,</p>
                <p>Please find attached your <strong>${schedule.frequency}</strong> SEO report for <strong>${schedule.site.url}</strong>.</p>
                <p>If you have any questions, feel free to reply to this email.</p>
                <br/>
                <p>Best regards,<br/><strong>AutoSEO Pro Team</strong></p>
              </div>
            `,
            attachments: [
              {
                filename: `${schedule.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                path: fullPdfPath
              }
            ]
          });

          // Create a record in ClientReport to show it was sent
          await prisma.clientReport.create({
            data: {
              siteId: schedule.siteId,
              name: schedule.name,
              type: schedule.frequency,
              status: 'Sent to Client',
              fileUrl: pdfPath, // Store the local path URL
            }
          });
          
          console.log(`Successfully sent report to ${schedule.emails}`);

        } catch (scheduleError) {
          console.error(`Failed to execute schedule ${schedule.id}:`, scheduleError);
          // Optional: Record failure in ClientReport
          await prisma.clientReport.create({
            data: {
              siteId: schedule.siteId,
              name: schedule.name,
              type: schedule.frequency,
              status: 'Failed',
            }
          });
        }
      }
    } catch (error) {
      console.error('Error in report cron job:', error);
    }
  });
  
  console.log('Report Cron Job initialized.');
};

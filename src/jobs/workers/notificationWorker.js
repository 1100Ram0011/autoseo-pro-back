import { Worker } from "bullmq";
import logger from "../../config/logger.js";
import { connection } from "../index.js";
import { sendSMSDirect } from "../../utils/sendSMS.js";
import { sendOutlookMailDirect } from "../../config/mailer.js";
import { sendWhatsAppDirect } from "../../utils/sendWhatAppTemplete.js";

const worker = new Worker(
  "notification-queue",
  async (job) => {
    const { name, data } = job;
    logger.info(`Processing ${name} job: ${job.id}`);

    switch (name) {
      case "sms":
        await sendSMSDirect(data.mobileNumber, data.otp);
        break;
      case "email":
        await sendOutlookMailDirect(data);
        break;
      case "whatsapp":
        const { to, templateName, params } = data;
        const res = await sendWhatsAppDirect(to, templateName, params);
        if (!res.success) {
          throw new Error(res.error || "WhatsApp API failed");
        }
        break;
      default:
        logger.warn(`Unknown job type: ${name}`);
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 jobs at a time
  },
);

worker.on("completed", (job) => {
  logger.info(`Job ${job.id} (${job.name}) completed successfully`);
});

worker.on("failed", (job, err) => {
  logger.error(`Job ${job.id} (${job.name}) failed: ${err.message}`);
});

export default worker;

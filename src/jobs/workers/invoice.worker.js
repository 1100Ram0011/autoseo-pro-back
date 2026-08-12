import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import { generateInvoiceForTransaction } from "../../services/invoice.service.js";
import logger from "../../config/logger.js";
import PayuTransaction from "../../models/credits/PayuTransaction.js";
import RazorpayTransaction from "../../models/credits/RazorpayTransaction.js";
import SwapTemplate from "../../models/SwapTemplate.js";
import PixverseprompttemplateModel from "../../models/Pixverse/Pixverseprompttemplate.model.js";

const worker = new Worker(
  "invoice-queue",
  async (job) => {
    const { transactionId, wasOnFreePlan, isVideoTemplatePurchase, isFaceswap } = job.data;
    logger.info(`Processing invoice generation for transaction: ${transactionId}`);

    try {
      let title;
      const truncate = (str, max = 30) => {
        if (!str) return "";
        return str.length > max ? str.slice(0, max) + "..." : str;
      };
      if (isVideoTemplatePurchase) {
        let transaction = await PayuTransaction.findById(transactionId);
        if (!transaction) {
          transaction = await RazorpayTransaction.findById(transactionId);
        }

        if (isFaceswap) {
          const request = await SwapTemplate.findById(transaction.templateId);
          title = truncate(
            request?.title ?? "Face Swap Video"
          );
        } else {
          const request = await PixverseprompttemplateModel.findById(
            transaction.templateId
          );
          title = truncate(
            request?.title ?? "Image To Video"
          );
        }
      }
      const invoice = await generateInvoiceForTransaction(transactionId, wasOnFreePlan, isVideoTemplatePurchase, title);
      logger.info(`Invoice generated successfully: ${invoice.invoiceNumber}`);
      if (invoice && invoice.metadata) {
        logger.info(`Invoice metadata saved: ${JSON.stringify(invoice.metadata)}`);
      }
      return { success: true, invoiceNumber: invoice.invoiceNumber, pdfLink: invoice.pdfLink };
    } catch (error) {
      logger.error(`Error generating invoice for transaction ${transactionId}:`, error);
      throw error;
    }
  },
  { connection: redisClient },
);

worker.on("completed", (job) => {
  logger.info(`Invoice job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  logger.error(`Invoice job ${job.id} failed: ${err.message}`);
});

export default worker;

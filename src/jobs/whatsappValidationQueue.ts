import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import prisma from '../config/prisma';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import waApi from '../services/whatsappEngine.service';
import { uploadToS3, deleteFromS3 } from '../services/upload.service';

export const WHATSAPP_VALIDATION_QUEUE_NAME = 'whatsapp-number-validation-queue';

export const whatsappValidationQueue = new Queue(WHATSAPP_VALIDATION_QUEUE_NAME, {
  connection: redis
});

export const whatsappValidationQueueEvents = new QueueEvents(WHATSAPP_VALIDATION_QUEUE_NAME, {
  connection: redis
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeRow = (row: any) => {
  const cleaned: any = {};
  Object.entries(row).forEach(([key, value]) => {
    cleaned[String(key).replace(/^\uFEFF/, "").trim()] = value;
  });
  return cleaned;
};

const getPhoneNumber = (row: any) => {
  const keys = Object.keys(row);
  const phoneKey = keys.find(key => {
    const normalized = key.toLowerCase().trim();
    return [
      "mobile", "phone", "number", "contact", "contact number",
      "mobile number", "whatsapp", "whatsapp number", "phone number",
      "mobile no", "phone no"
    ].includes(normalized);
  });
  return phoneKey ? String(row[phoneKey] || "").trim() : "";
};

const parseFile = (buffer: Buffer, fileName: string) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const csvText = buffer.toString("utf8");
    const rows = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
    return rows.map(normalizeRow);
  }
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("No sheet found");
  const worksheet = workbook.Sheets[sheetName] as any;
  return XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false }).map(normalizeRow);
};

export const whatsappValidationWorker = new Worker(
  WHATSAPP_VALIDATION_QUEUE_NAME,
  async (job) => {
    const { jobId, accountId } = job.data;
    if (!jobId) throw new Error("jobId missing in queue payload");

    console.log(`[VALIDATOR] Starting Job ${jobId}`);
    
    let dbJob = await prisma.whatsappValidationJob.findUnique({ where: { id: jobId } });
    if (!dbJob) return;

    dbJob = await prisma.whatsappValidationJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING" }
    });

    try {
      console.log("[VALIDATOR] Downloading file from:", dbJob.sourceFileUrl);
      const fileResponse = await axios.get(dbJob.sourceFileUrl, { responseType: "arraybuffer" });
      
      const rows = parseFile(Buffer.from(fileResponse.data), dbJob.originalFileName);
      console.log(`[VALIDATOR] Total rows: ${rows.length}`);
      
      await prisma.whatsappValidationJob.update({
        where: { id: jobId },
        data: { totalRows: rows.length }
      });

      const results = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const phone = getPhoneNumber(row);
        let isWhatsapp = false;

        if (phone) {
          try {
            await delay(Math.floor(Math.random() * 4000) + 3000);
            
            const response = await waApi.post("/check-number-account", {
              accountId: accountId, // Using the requesting user's account ID instead of hardcoded admin email
              number: phone,
            });
            isWhatsapp = response?.data?.data?.whatsapp || false;
            console.log(`[VALIDATOR] ${phone} => ${isWhatsapp}`);
          } catch (error: any) {
            const message = error.response?.data?.message || error.message;
            console.error("[VALIDATOR] Engine Check Failed", message);
            
            if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(error.code) || message?.includes("socket hang up")) {
              throw new Error("WhatsApp server is offline");
            }
            if (message === "WhatsApp not connected" || message === "No connected WhatsApp accounts found") {
              throw new Error(message);
            }
          }
        }

        results.push({ ...row, isWhatsapp });

        if ((i + 1) % 10 === 0) {
          await prisma.whatsappValidationJob.update({
            where: { id: jobId },
            data: { processedRows: i + 1 }
          });
          job.updateProgress({ percent: Math.floor(((i + 1) / rows.length) * 100), label: `Processed ${i+1}/${rows.length}` });
        }
      }

      const outputWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(outputWorkbook, XLSX.utils.json_to_sheet(results), "Results");
      const outputBuffer = XLSX.write(outputWorkbook, { type: "buffer", bookType: "xlsx" });

      const resultFileUrl = await uploadToS3(
        Buffer.from(outputBuffer),
        `${jobId}.xlsx`,
        "whatsapp-validator/result",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        `attachment; filename="whatsapp-validation-${jobId}.xlsx"`
      );

      await prisma.whatsappValidationJob.update({
        where: { id: jobId },
        data: {
          resultFileUrl,
          processedRows: rows.length,
          status: "COMPLETED"
        }
      });
      job.updateProgress({ percent: 100, label: "Completed" });

      try {
        await deleteFromS3(dbJob.sourceFileUrl);
      } catch (err: any) {
        console.error("[VALIDATOR] Failed to delete source file", err.message);
      }

      return { success: true, processed: rows.length };
    } catch (error: any) {
      console.error(`[VALIDATOR] JOB FAILED: ${error.message}`);
      await prisma.whatsappValidationJob.update({
        where: { id: jobId },
        data: { status: "FAILED", error: error.message }
      });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 1,
  }
);

whatsappValidationWorker.on('completed', (job) => {
  console.log(`[VALIDATOR Worker] Job ${job.id} has completed!`);
});
whatsappValidationWorker.on('failed', (job, err) => {
  console.log(`[VALIDATOR Worker] Job ${job?.id} failed with error ${err.message}`);
});

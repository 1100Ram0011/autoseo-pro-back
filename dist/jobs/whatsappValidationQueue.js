"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappValidationWorker = exports.whatsappValidationQueueEvents = exports.whatsappValidationQueue = exports.WHATSAPP_VALIDATION_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const prisma_1 = __importDefault(require("../config/prisma"));
const axios_1 = __importDefault(require("axios"));
const XLSX = __importStar(require("xlsx"));
const sync_1 = require("csv-parse/sync");
const whatsappEngine_service_1 = __importDefault(require("../services/whatsappEngine.service"));
const upload_service_1 = require("../services/upload.service");
exports.WHATSAPP_VALIDATION_QUEUE_NAME = 'whatsapp-number-validation-queue';
exports.whatsappValidationQueue = new bullmq_1.Queue(exports.WHATSAPP_VALIDATION_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.whatsappValidationQueueEvents = new bullmq_1.QueueEvents(exports.WHATSAPP_VALIDATION_QUEUE_NAME, {
    connection: redis_1.redis
});
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizeRow = (row) => {
    const cleaned = {};
    Object.entries(row).forEach(([key, value]) => {
        cleaned[String(key).replace(/^\uFEFF/, "").trim()] = value;
    });
    return cleaned;
};
const getPhoneNumber = (row) => {
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
const parseFile = (buffer, fileName) => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "csv") {
        const csvText = buffer.toString("utf8");
        const rows = (0, sync_1.parse)(csvText, { columns: true, skip_empty_lines: true, bom: true });
        return rows.map(normalizeRow);
    }
    const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
        throw new Error("No sheet found");
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false }).map(normalizeRow);
};
exports.whatsappValidationWorker = new bullmq_1.Worker(exports.WHATSAPP_VALIDATION_QUEUE_NAME, async (job) => {
    const { jobId, accountId } = job.data;
    if (!jobId)
        throw new Error("jobId missing in queue payload");
    console.log(`[VALIDATOR] Starting Job ${jobId}`);
    let dbJob = await prisma_1.default.whatsappValidationJob.findUnique({ where: { id: jobId } });
    if (!dbJob)
        return;
    dbJob = await prisma_1.default.whatsappValidationJob.update({
        where: { id: jobId },
        data: { status: "PROCESSING" }
    });
    try {
        console.log("[VALIDATOR] Downloading file from:", dbJob.sourceFileUrl);
        const fileResponse = await axios_1.default.get(dbJob.sourceFileUrl, { responseType: "arraybuffer" });
        const rows = parseFile(Buffer.from(fileResponse.data), dbJob.originalFileName);
        console.log(`[VALIDATOR] Total rows: ${rows.length}`);
        await prisma_1.default.whatsappValidationJob.update({
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
                    const response = await whatsappEngine_service_1.default.post("/check-number-account", {
                        accountId: accountId, // Using the requesting user's account ID instead of hardcoded admin email
                        number: phone,
                    });
                    isWhatsapp = response?.data?.data?.whatsapp || false;
                    console.log(`[VALIDATOR] ${phone} => ${isWhatsapp}`);
                }
                catch (error) {
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
                await prisma_1.default.whatsappValidationJob.update({
                    where: { id: jobId },
                    data: { processedRows: i + 1 }
                });
                job.updateProgress({ percent: Math.floor(((i + 1) / rows.length) * 100), label: `Processed ${i + 1}/${rows.length}` });
            }
        }
        const outputWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(outputWorkbook, XLSX.utils.json_to_sheet(results), "Results");
        const outputBuffer = XLSX.write(outputWorkbook, { type: "buffer", bookType: "xlsx" });
        const resultFileUrl = await (0, upload_service_1.uploadToS3)(Buffer.from(outputBuffer), `${jobId}.xlsx`, "whatsapp-validator/result", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `attachment; filename="whatsapp-validation-${jobId}.xlsx"`);
        await prisma_1.default.whatsappValidationJob.update({
            where: { id: jobId },
            data: {
                resultFileUrl,
                processedRows: rows.length,
                status: "COMPLETED"
            }
        });
        job.updateProgress({ percent: 100, label: "Completed" });
        try {
            await (0, upload_service_1.deleteFromS3)(dbJob.sourceFileUrl);
        }
        catch (err) {
            console.error("[VALIDATOR] Failed to delete source file", err.message);
        }
        return { success: true, processed: rows.length };
    }
    catch (error) {
        console.error(`[VALIDATOR] JOB FAILED: ${error.message}`);
        await prisma_1.default.whatsappValidationJob.update({
            where: { id: jobId },
            data: { status: "FAILED", error: error.message }
        });
        throw error;
    }
}, {
    connection: redis_1.redis,
    concurrency: 1,
});
exports.whatsappValidationWorker.on('completed', (job) => {
    console.log(`[VALIDATOR Worker] Job ${job.id} has completed!`);
});
exports.whatsappValidationWorker.on('failed', (job, err) => {
    console.log(`[VALIDATOR Worker] Job ${job?.id} failed with error ${err.message}`);
});
//# sourceMappingURL=whatsappValidationQueue.js.map
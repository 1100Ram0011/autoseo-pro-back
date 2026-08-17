// @ts-nocheck
import XLSX from "xlsx";
import axios from "axios";
import { parse } from "csv-parse/sync";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import whatsappEngineApi from "../../services/whatsappEngine.service.js";
import { uploadToS3, deleteFromS3 } from "../../utils/upload.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeRow = (row: any) => {
    const cleaned: any = {};
    Object.entries(row).forEach(([key, value]) => {
        cleaned[String(key).replace(/^\uFEFF/, "").trim()] = value;
    });
    return cleaned;
};

const getPhoneNumber = (row: any) => {
    const keys = Object.keys(row);
    const phoneKey = keys.find((key) => {
        const normalized = key.toLowerCase().trim();
        return [
            "mobile",
            "phone",
            "number",
            "contact",
            "contact number",
            "mobile number",
            "whatsapp",
            "whatsapp number",
            "phone number",
            "mobile no",
            "phone no",
        ].includes(normalized);
    });
    return phoneKey ? String(row[phoneKey] || "").trim() : "";
};

const parseFile = (buffer: Buffer, fileName: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    console.log("[VALIDATOR] File Extension:", extension);

    if (extension === "csv") {
        const csvText = Buffer.from(buffer).toString("utf8");
        const rows = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
        return rows.map(normalizeRow);
    }

    const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
    console.log("[VALIDATOR] Sheets:", workbook.SheetNames);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("No sheet found");

    // @ts-ignore
    return (XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false }) as any[]).map(normalizeRow);
};

export class ValidationStoppedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationStoppedError";
    }
}

const failJob = async (jobId: string, message: string) => {
    console.error(`[VALIDATOR] JOB FAILED: ${message}`);
    await prisma.whatsappValidationJob.update({
        where: { id: jobId },
        data: { status: "FAILED", error: message }
    });
    throw new ValidationStoppedError(message);
};

export const processValidation = async (jobId: string) => {
    try {
        console.log(`[VALIDATOR] Starting Job ${jobId}`);

        const dbJob = await prisma.whatsappValidationJob.findUnique({ where: { id: jobId } });
        if (!dbJob) {
            console.log(`[VALIDATOR] Job not found ${jobId}`);
            return;
        }

        await prisma.whatsappValidationJob.update({
            where: { id: jobId },
            data: { status: "PROCESSING" }
        });

        const adminLogin = await prisma.user.findUnique({
            where: { email: "shiv.borade.ai@gmail.com" },
        });

        if (!adminLogin) {
            throw new Error("Admin account not found");
        }

        console.log("[VALIDATOR] Downloading file");
        const fileResponse = await axios.get(dbJob.sourceFileUrl, { responseType: "arraybuffer" });
        console.log("[VALIDATOR] File downloaded", { bytes: fileResponse.data?.byteLength });

        const rows = parseFile(fileResponse.data, dbJob.originalFileName);
        console.log("[VALIDATOR] Total rows:", rows.length);

        if (rows.length) {
            console.log("[VALIDATOR] Sample row:", rows[0]);
            console.log("[VALIDATOR] Headers:", Object.keys(rows[0]));
        }

        await prisma.whatsappValidationJob.update({
            where: { id: jobId },
            data: { totalRows: rows.length }
        });

        const results: any[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const phone = getPhoneNumber(row);
            console.log(`[VALIDATOR] Row ${i + 1}/${rows.length} Phone: ${phone}`);

            let isWhatsapp = false;

            if (!phone) {
                results.push({ ...row, isWhatsapp: false });
                continue;
            }

            try {
                await delay(Math.floor(Math.random() * 4000) + 3000);
                const response = await whatsappEngineApi.post("/check-number-account", {
                    accountId: adminLogin.id,
                    number: phone,
                });
                isWhatsapp = response?.data?.data?.whatsapp || false;
                console.log(`[VALIDATOR] ${phone} => ${isWhatsapp}`);
            } catch (error: any) {
                const message = error.response?.data?.message || error.message;
                console.error("[VALIDATOR] Engine Check Failed", message);

                if (
                    error.code === "ECONNREFUSED" ||
                    error.code === "ECONNRESET" ||
                    error.code === "ETIMEDOUT" ||
                    error.code === "ENOTFOUND" ||
                    error.message?.includes("socket hang up")
                ) {
                    await failJob(jobId, "WhatsApp server is offline");
                }

                if (message === "WhatsApp not connected" || message === "No connected WhatsApp accounts found") {
                    await failJob(jobId, message);
                }
            }

            results.push({ ...row, isWhatsapp });

            if ((i + 1) % 10 === 0) {
                await prisma.whatsappValidationJob.update({
                    where: { id: jobId },
                    data: { processedRows: i + 1 }
                });
                console.log(`[VALIDATOR] Progress ${i + 1}/${rows.length}`);
            }
        }

        const outputWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(outputWorkbook, XLSX.utils.json_to_sheet(results), "Results");
        const outputBuffer = XLSX.write(outputWorkbook, { type: "buffer", bookType: "xlsx" });

        const resultFileUrl = await uploadToS3(
            outputBuffer,
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

        console.log(`[VALIDATOR] Job Completed ${jobId}`);

        try {
            await deleteFromS3(dbJob.sourceFileUrl);
        } catch (error: any) {
            console.error("[VALIDATOR] Failed to delete source file", error.message);
        }

    } catch (error: any) {
        if (error instanceof ValidationStoppedError) {
            console.log("[VALIDATOR] Job intentionally stopped:", error.message);
            return;
        }
        throw error;
    }
};


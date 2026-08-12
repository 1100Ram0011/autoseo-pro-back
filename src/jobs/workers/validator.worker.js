// workers/validator.worker.js

import XLSX from "xlsx";
import axios from "axios";
import { parse } from "csv-parse/sync";

import WhatsappValidationJob
    from "../../models/WhatsappValidationJob.js";

import whatsappEngineApi
    from "../../services/whatsappEngine.service.js";

import {
    uploadToS3,
    deleteFromS3,
} from "../../utils/upload.js";

import userModel
    from "../../models/userModel.js";

const delay = ms =>
    new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

const normalizeRow =
    row => {

        const cleaned =
            {};

        Object.entries(
            row
        ).forEach(
            ([key, value]) => {

                cleaned[
                    String(key)
                        .replace(
                            /^\uFEFF/,
                            ""
                        )
                        .trim()
                ] = value;
            }
        );

        return cleaned;
    };

const getPhoneNumber =
    row => {

        const keys =
            Object.keys(
                row
            );

        const phoneKey =
            keys.find(
                key => {

                    const normalized =
                        key
                            .toLowerCase()
                            .trim();

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
                    ].includes(
                        normalized
                    );
                }
            );

        return phoneKey
            ? String(
                row[
                phoneKey
                ] || ""
            ).trim()
            : "";
    };

const parseFile =
    (
        buffer,
        fileName
    ) => {

        const extension =
            fileName
                .split(".")
                .pop()
                ?.toLowerCase();

        console.log(
            "[VALIDATOR] File Extension:",
            extension
        );

        if (
            extension ===
            "csv"
        ) {

            const csvText =
                Buffer.from(
                    buffer
                ).toString(
                    "utf8"
                );

            const rows =
                parse(
                    csvText,
                    {
                        columns:
                            true,
                        skip_empty_lines:
                            true,
                        bom: true,
                    }
                );

            return rows.map(
                normalizeRow
            );
        }

        const workbook =
            XLSX.read(
                buffer,
                {
                    type:
                        "buffer",
                    raw: false,
                }
            );

        console.log(
            "[VALIDATOR] Sheets:",
            workbook.SheetNames
        );

        const sheetName =
            workbook
                .SheetNames[0];

        if (
            !sheetName
        ) {

            throw new Error(
                "No sheet found"
            );
        }

        return XLSX.utils
            .sheet_to_json(
                workbook.Sheets[
                sheetName
                ],
                {
                    defval: "",
                    raw: false,
                }
            )
            .map(
                normalizeRow
            );
    };

export class ValidationStoppedError
    extends Error {

    constructor(
        message
    ) {

        super(
            message
        );

        this.name =
            "ValidationStoppedError";
    }
}


const failJob =
    async (
        dbJob,
        message
    ) => {

        console.error(
            `[VALIDATOR] JOB FAILED: ${message}`
        );

        dbJob.status =
            "FAILED";

        dbJob.error =
            message;

        await dbJob.save();

        throw new ValidationStoppedError(
            message
        );
    };
export const processValidation =
    async jobId => {

        let dbJob;

        try {

            console.log(
                `[VALIDATOR] Starting Job ${jobId}`
            );

            dbJob =
                await WhatsappValidationJob.findById(
                    jobId
                );

            if (
                !dbJob
            ) {

                console.log(
                    `[VALIDATOR] Job not found ${jobId}`
                );

                return;
            }

            dbJob.status =
                "PROCESSING";

            await dbJob.save();

            const adminLogin =
                await userModel
                    .findOne({
                        email:
                            "shiv.borade.ai@gmail.com",
                    })
                    .lean();

            if (
                !adminLogin
            ) {

                throw new Error(
                    "Admin account not found"
                );
            }

            console.log(
                "[VALIDATOR] Downloading file"
            );

            const fileResponse =
                await axios.get(
                    dbJob.sourceFileUrl,
                    {
                        responseType:
                            "arraybuffer",
                    }
                );

            console.log(
                "[VALIDATOR] File downloaded",
                {
                    bytes:
                        fileResponse
                            .data
                            ?.byteLength,
                }
            );

            const rows =
                parseFile(
                    fileResponse.data,
                    dbJob.originalFileName
                );

            console.log(
                "[VALIDATOR] Total rows:",
                rows.length
            );

            if (
                rows.length
            ) {

                console.log(
                    "[VALIDATOR] Sample row:",
                    rows[0]
                );

                console.log(
                    "[VALIDATOR] Headers:",
                    Object.keys(
                        rows[0]
                    )
                );
            }

            dbJob.totalRows =
                rows.length;

            await dbJob.save();

            const results =
                [];

            for (
                let i = 0;
                i <
                rows.length;
                i++
            ) {

                const row =
                    rows[i];

                const phone =
                    getPhoneNumber(
                        row
                    );

                console.log(
                    `[VALIDATOR] Row ${i + 1
                    }/${rows.length
                    } Phone: ${phone}`
                );

                let isWhatsapp =
                    false;

                if (
                    !phone
                ) {

                    results.push(
                        {
                            ...row,
                            isWhatsapp:
                                false,
                        }
                    );

                    continue;
                }

                try {

                    await delay(
                        Math.floor(
                            Math.random() *
                            4000
                        ) + 3000
                    );

                    const response =
                        await whatsappEngineApi.post(
                            "/check-number-account",
                            {
                                accountId:
                                    adminLogin._id.toString(),
                                number:
                                    phone,
                            }
                        );

                    isWhatsapp =
                        response?.data
                            ?.data
                            ?.whatsapp ||
                        false;

                    console.log(
                        `[VALIDATOR] ${phone} => ${isWhatsapp}`
                    );

                } catch (error) {

                    const message =
                        error.response?.data
                            ?.message ||
                        error.message;

                    console.error(
                        "[VALIDATOR] Engine Check Failed",
                        message
                    );

                    if (
                        error.code ===
                        "ECONNREFUSED" ||

                        error.code ===
                        "ECONNRESET" ||

                        error.code ===
                        "ETIMEDOUT" ||

                        error.code ===
                        "ENOTFOUND" ||

                        error.message?.includes(
                            "socket hang up"
                        )
                    ) {

                        await failJob(
                            dbJob,
                            "WhatsApp server is offline"
                        );
                    }

                    if (
                        message ===
                        "WhatsApp not connected" || message === "No connected WhatsApp accounts found"
                    ) {

                        await failJob(
                            dbJob,
                            message
                        );
                    }
                }

                results.push(
                    {
                        ...row,
                        isWhatsapp,
                    }
                );

                dbJob.processedRows =
                    i + 1;

                if (
                    (i + 1) %
                    10 ===
                    0
                ) {

                    await dbJob.save();

                    console.log(
                        `[VALIDATOR] Progress ${i + 1
                        }/${rows.length
                        }`
                    );
                }
            }

            const outputWorkbook =
                XLSX.utils.book_new();

            XLSX.utils.book_append_sheet(
                outputWorkbook,
                XLSX.utils.json_to_sheet(
                    results
                ),
                "Results"
            );

            const outputBuffer =
                XLSX.write(
                    outputWorkbook,
                    {
                        type:
                            "buffer",
                        bookType:
                            "xlsx",
                    }
                );

            const resultFileUrl =
                await uploadToS3(
                    outputBuffer,
                    `${jobId}.xlsx`,
                    "whatsapp-validator/result",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    `attachment; filename="whatsapp-validation-${jobId}.xlsx"`
                );

            dbJob.resultFileUrl =
                resultFileUrl;

            dbJob.processedRows =
                rows.length;

            dbJob.status =
                "COMPLETED";

            await dbJob.save();

            console.log(
                `[VALIDATOR] Job Completed ${jobId}`
            );

            try {

                await deleteFromS3(
                    dbJob.sourceFileUrl
                );

            } catch (
            error
            ) {

                console.error(
                    "[VALIDATOR] Failed to delete source file",
                    error.message
                );
            }

        } catch (error) {

            if (
                error instanceof
                ValidationStoppedError
            ) {

                console.log(
                    "[VALIDATOR] Job intentionally stopped:",
                    error.message
                );

                return;
            }

            throw error;
        }

    };
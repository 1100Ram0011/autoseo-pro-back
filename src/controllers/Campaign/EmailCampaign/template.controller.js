import templateSchema from "../../../models/Campaign/EmailCampaign/templateSchema.js";
import { extractVariables } from "../../../services/template.service.js";
import { uploadToS3, deleteFromS3 } from "../../../utils/emailTemplateCampaignUpload.js";
import config from "../../../config/config.js";
import logger from "../../../config/logger.js";

// ==============================
// CREATE TEMPLATE
// ==============================
export const createTemplate = async (req, res) => {
    try {
        const { name, subject, html, design } = req.body;
        const userId = req.user.id;

        if (!name?.trim() || !subject?.trim() || !html?.trim()) {
            return res.status(400).json({
                message: "Name, subject, and HTML content are required.",
            });
        }

        const existingTemplate = await templateSchema.findOne({
            userId,
            isActive: true,
            name: name.trim(),
        });

        if (existingTemplate) {
            return res.status(409).json({
                message: "Template name already exists. Please use a different name.",
            });
        }

        const variables = extractVariables(html);
        let attachments = [];

        // =========================
        // FILE UPLOAD HANDLING
        // =========================

        if (req.files?.length) {

            const uploadPromises = req.files.map(async (file) => {

                const fileKey = `${Date.now()}-${file.originalname}`;

                const { key, url } = await uploadToS3(
                    file.buffer,
                    fileKey,
                    config.AWS_S3_TEMPLATE_ATTACHMENT_FOLDER,
                    file.mimetype,
                    "inline"
                );

                if (!key) {
                    throw new Error("S3 upload failed: missing key");
                }

                return {
                    key,
                    url,
                    originalName: file.originalname,
                    contentType: file.mimetype,
                    size: file.size,
                };
            });

            attachments = await Promise.all(uploadPromises);
        }

        // =========================
        // CREATE TEMPLATE
        // =========================

        const template = await templateSchema.create({
            userId,
            name: name.trim(),
            subject: subject.trim(),
            html,
            design,
            variables,
            attachments,
            createdBy: req.user?.id,
        });

        return res.status(201).json({
            message: "Template created successfully",
            template,
        });

    } catch (error) {

        // =========================
        // 🔥 HANDLE UNIQUE CONSTRAINT ERROR
        // =========================

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "field";
            const value = error.keyValue?.[field];

            return res.status(409).json({
                message: `${field.charAt(0).toUpperCase() + field.slice(1)} "${value}" already exists.`,
            });
        }

        // =========================
        // VALIDATION ERROR (Mongoose)
        // =========================

        if (error.name === "ValidationError") {
            const firstError = Object.values(error.errors)[0]?.message;
            return res.status(400).json({
                message: firstError || "Validation failed.",
            });
        }

        // =========================
        // GENERIC SERVER ERROR
        // =========================

        logger.error(`Template creation failed: ${error.message}`);

        return res.status(500).json({
            message: "Failed to create template",
        });
    }
};


// ==============================
// UPDATE TEMPLATE
// ==============================
export const updateTemplate = async (req, res) => {
    try {
        const { name, subject, html, removeAttachments } = req.body;
        const templateId = req.params.id;
        const userId = req.user.id;

        if (!templateId) {
            return res.status(400).json({ message: "Template ID is required" });
        }

        // 🔹 Find template (with org protection)
        const template = await templateSchema.findOne({
            userId,
            _id: templateId,
            isActive: true,
        });

        if (!template) {
            return res.status(404).json({ message: "Template not found" });
        }

        // =========================
        // UPDATE BASIC FIELDS
        // =========================

        if (name) template.name = name;
        if (subject) template.subject = subject;

        if (html) {
            template.html = html;
            template.variables = extractVariables(html);
        }

        if (req.body.design) {
            template.design = req.body.design;
        }

        // =========================
        // REMOVE ATTACHMENTS
        // =========================

        if (removeAttachments) {

            let keysToRemove = [];

            if (Array.isArray(removeAttachments)) {
                keysToRemove = removeAttachments;
            } else if (typeof removeAttachments === "string") {
                try {
                    keysToRemove = JSON.parse(removeAttachments);
                } catch (err) {
                    return res.status(400).json({
                        message: "removeAttachments must be valid JSON array",
                    });
                }
            }

            if (keysToRemove.length > 0) {

                // Delete from S3
                await Promise.all(
                    keysToRemove.map(async (key) => {
                        try {
                            await deleteFromS3(key);
                        } catch (err) {
                            logger.warn(
                                `S3 deletion failed for ${key}: ${err.message}`
                            );
                        }
                    })
                );

                // 🔹 Remove from DB
                template.attachments = template.attachments.filter(
                    (att) => !keysToRemove.includes(att.key)
                );
            }
        }

        // =========================
        // ADD NEW ATTACHMENTS
        // =========================

        if (req.files && req.files.length > 0) {

            const uploadPromises = req.files.map(async (file) => {

                const fileKey = `${Date.now()}-${file.originalname}`;

                const result = await uploadToS3(
                    file.buffer,
                    fileKey,
                    config.AWS_S3_TEMPLATE_ATTACHMENT_FOLDER,
                    file.mimetype,
                    "inline"
                );

                if (!result?.key || !result?.url) {
                    throw new Error("S3 upload failed");
                }

                return {
                    key: result.key,
                    url: result.url,
                    originalName: file.originalname,
                    contentType: file.mimetype,
                    size: file.size,
                };
            });

            const newAttachments = await Promise.all(uploadPromises);

            // Append new files (do not overwrite old)
            template.attachments.push(...newAttachments);
        }

        // =========================
        // VERSION INCREMENT
        // =========================

        template.version += 1;

        await template.save();

        return res.status(200).json({
            message: "Template updated successfully",
            template,
        });

    } catch (error) {

        // =========================
        // 🔥 HANDLE UNIQUE CONSTRAINT ERROR
        // =========================

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "field";
            const value = error.keyValue?.[field];

            return res.status(409).json({
                message: `${field.charAt(0).toUpperCase() + field.slice(1)} "${value}" already exists.`,
            });
        }

        // =========================
        // VALIDATION ERROR (Mongoose)
        // =========================

        if (error.name === "ValidationError") {
            const firstError = Object.values(error.errors)[0]?.message;
            return res.status(400).json({
                message: firstError || "Validation failed.",
            });
        }


        logger.error(`Template update failed: ${error.message}`);

        return res.status(500).json({
            message: "Failed to update template",
        });
    }
};

// ==============================
// GET ALL TEMPLATES
// ==============================
export const getTemplates = async (req, res) => {
    try {
        const { select } = req.query;
        
        let query = templateSchema
            .find({ isActive: true, userId: req.user.id })
            .sort({ createdAt: -1 });

        if (select) {
            // allows comma-separated or space-separated fields, e.g. "?select=sourceAITemplate,_id"
            query = query.select(select.replace(/,/g, " "));
        } else {
            query = query.select("-__v");
        }

        const templates = await query;
        res.json(templates);
    } catch (error) {
        logger.error(`Fetch templates failed: ${error.message}`);
        res.status(500).json({ message: "Failed to fetch templates" });
    }
};


// ==============================
// GET TEMPLATE BY ID
// ==============================
export const getTemplateById = async (req, res) => {
    try {
        const template = await templateSchema.findOne({ _id: req.params.id, userId: req.user.id });

        if (!template) {
            return res.status(404).json({ message: "Template not found" });
        }

        res.json(template);
    } catch (error) {
        logger.error(`Get template failed: ${error.message}`);
        res.status(500).json({ message: "Failed to fetch template" });
    }
};

// ==============================
// DELETE TEMPLATE (SOFT DELETE)
// ==============================
export const deleteTemplate = async (req, res) => {
    try {
        const template = await templateSchema.findOne({ _id: req.params.id, userId: req.user.id });

        if (!template) {
            return res.status(404).json({ message: "Template not found" });
        }

        template.isActive = false;
        await template.save();

        res.json({ message: "Template deleted successfully" });

    } catch (error) {
        logger.error(`Template deletion failed: ${error.message}`);
        res.status(500).json({ message: "Failed to delete template" });
    }
};

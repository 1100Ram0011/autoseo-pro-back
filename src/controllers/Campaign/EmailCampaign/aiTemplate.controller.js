import AIEmailTemplate from "../../../models/Campaign/EmailCampaign/aiTemplateSchema.js";
import EmailTemplate from "../../../models/Campaign/EmailCampaign/templateSchema.js";
import { extractVariables } from "../../../services/template.service.js";
import { emailTemplateAIQueue } from "../../../queue/index.js";
import crypto from "crypto";
import logger from "../../../config/logger.js";

// ============================================================
//  ADMIN: CREATE AI TEMPLATE
// ============================================================
export const createAITemplate = async (req, res) => {
    try {
        const {
            name,
            subject,
            html,
            design,
            prompt,
            category,
            description,
            thumbnailUrl,
            tags,
            isFeatured,
        } = req.body;

        if (!name?.trim() || !subject?.trim() || !html?.trim()) {
            return res.status(400).json({
                message: "Name, subject, and HTML content are required.",
            });
        }

        const existing = await AIEmailTemplate.findOne({
            name: name.trim(),
            isActive: true,
        });

        if (existing) {
            return res.status(409).json({
                message: "An AI template with this name already exists.",
            });
        }

        const variables = extractVariables(html);

        const template = await AIEmailTemplate.create({
            name: name.trim(),
            subject: subject.trim(),
            html,
            design: design || "",
            prompt: prompt?.trim() || "",
            category: category || "General",
            description: description?.trim() || "",
            thumbnailUrl: thumbnailUrl || "",
            variables,
            tags: Array.isArray(tags) ? tags : [],
            isFeatured: !!isFeatured,
            createdBy: req.user.id,
        });

        return res.status(201).json({
            message: "AI template created successfully",
            template,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "Duplicate template name.",
            });
        }
        logger.error(`AI template creation failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to create AI template" });
    }
};

// ============================================================
//  ADMIN: UPDATE AI TEMPLATE
// ============================================================
export const updateAITemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            subject,
            html,
            design,
            prompt,
            category,
            description,
            thumbnailUrl,
            tags,
            isFeatured,
        } = req.body;

        const template = await AIEmailTemplate.findOne({
            _id: id,
            isActive: true,
        });

        if (!template) {
            return res.status(404).json({ message: "AI template not found" });
        }

        if (name) template.name = name.trim();
        if (subject) template.subject = subject.trim();
        if (html) {
            template.html = html;
            template.variables = extractVariables(html);
        }
        if (design !== undefined) template.design = design;
        if (prompt !== undefined) template.prompt = prompt.trim();
        if (category) template.category = category;
        if (description !== undefined) template.description = description.trim();
        if (thumbnailUrl !== undefined) template.thumbnailUrl = thumbnailUrl;
        if (tags !== undefined) template.tags = Array.isArray(tags) ? tags : [];
        if (isFeatured !== undefined) template.isFeatured = isFeatured;

        template.version += 1;
        await template.save();

        return res.status(200).json({
            message: "AI template updated successfully",
            template,
        });
    } catch (error) {
        logger.error(`AI template update failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to update AI template" });
    }
};

// ============================================================
//  ADMIN: DELETE AI TEMPLATE (SOFT)
// ============================================================
export const deleteAITemplate = async (req, res) => {
    try {
        const template = await AIEmailTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ message: "AI template not found" });
        }

        template.isActive = false;
        await template.save();

        return res.json({ message: "AI template deleted successfully" });
    } catch (error) {
        logger.error(`AI template deletion failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to delete AI template" });
    }
};

// ============================================================
//  ADMIN: GET ALL AI TEMPLATES (includes inactive)
// ============================================================
export const getAllAITemplatesAdmin = async (req, res) => {
    try {
        const templates = await AIEmailTemplate.find()
            .populate("createdBy", "name email")
            .select("-__v")
            .sort({ createdAt: -1 });

        return res.json(templates);
    } catch (error) {
        logger.error(`Admin fetch AI templates failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to fetch AI templates" });
    }
};

// ============================================================
//  PUBLIC: GET ACTIVE AI TEMPLATES (for users to browse)
// ============================================================
export const getActiveAITemplates = async (req, res) => {
    try {
        const { category, search } = req.query;

        const filter = { isActive: true };
        if (category && category !== "All") filter.category = category;
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } },
                { tags: { $regex: search, $options: "i" } },
            ];
        }

        const templates = await AIEmailTemplate.find(filter)
            .select("-__v -design")
            .sort({ isFeatured: -1, usageCount: -1, createdAt: -1 });

        return res.json(templates);
    } catch (error) {
        logger.error(`Fetch AI templates failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to fetch AI templates" });
    }
};

// ============================================================
//  PUBLIC: GET SINGLE AI TEMPLATE
// ============================================================
export const getAITemplateById = async (req, res) => {
    try {
        const template = await AIEmailTemplate.findOne({
            _id: req.params.id,
            isActive: true,
        });

        if (!template) {
            return res.status(404).json({ message: "AI template not found" });
        }

        return res.json(template);
    } catch (error) {
        logger.error(`Fetch AI template failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to fetch AI template" });
    }
};

// ============================================================
//  USER: USE (COPY) AI TEMPLATE → user's EmailTemplate
// ============================================================
export const useAITemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { customName } = req.body; // optional override

        const aiTemplate = await AIEmailTemplate.findOne({
            _id: id,
            isActive: true,
        });

        if (!aiTemplate) {
            return res.status(404).json({ message: "AI template not found" });
        }

        // Build unique name
        const baseName = customName?.trim() || aiTemplate.name;
        let finalName = baseName;
        let counter = 1;

        // Ensure uniqueness within the user's templates
        while (
            await EmailTemplate.findOne({
                userId,
                name: finalName,
                isActive: true,
            })
        ) {
            finalName = `${baseName} (${counter})`;
            counter++;
        }

        // Copy to user's template collection
        const userTemplate = await EmailTemplate.create({
            userId,
            name: finalName,
            subject: aiTemplate.subject,
            html: aiTemplate.html,
            design: aiTemplate.design || "",
            variables: aiTemplate.variables || [],
            attachments: [],
            createdBy: userId,
            sourceAITemplate: aiTemplate._id,
            sourcePrompt: aiTemplate.prompt || "",
        });

        // Increment usage count
        await AIEmailTemplate.findByIdAndUpdate(id, {
            $inc: { usageCount: 1 },
        });

        return res.status(201).json({
            message: "Template copied to your library successfully",
            template: userTemplate,
        });
    } catch (error) {
        logger.error(`Use AI template failed: ${error.message}`);
        return res.status(500).json({ message: "Failed to use AI template" });
    }
};

// ============================================================
//  GENERATE AI TEMPLATE (via prompt + business profile)
//  Works for both Admin (global) and User (personal)
// ============================================================
export const generateAITemplate = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            prompt,
            targetUserId, // admin can specify which user's business data to use
            saveAs = "user_template", // "ai_template" (admin global) | "user_template" (user personal)
            dataType = "analysis", // "dummy" (placeholder data) | "analysis" (real business profile)
            category,
            isFeatured,
            tags,
            sourceAITemplateId, // Link to the AI template being customized
        } = req.body;

        if (!prompt?.trim()) {
            return res
                .status(400)
                .json({ message: "A prompt is required to generate a template." });
        }

        // Only admins can create global AI templates
        if (saveAs === "ai_template" && req.user.role !== "admin") {
            return res
                .status(403)
                .json({ message: "Only admins can create global AI templates." });
        }

        const jobId = crypto.randomUUID();

        await emailTemplateAIQueue.add(
            "generate-email-template",
            {
                userId,
                prompt: prompt.trim(),
                targetUserId: targetUserId || null,
                saveAs,
                dataType,
                category: category || "General",
                isFeatured: !!isFeatured,
                tags: Array.isArray(tags) ? tags : [],
                sourceAITemplateId: sourceAITemplateId || null,
                jobId,
            },
            { jobId }
        );

        return res.status(202).json({
            message: "Template generation started",
            jobId,
        });
    } catch (error) {
        logger.error(`AI template generation enqueue failed: ${error.message}`);
        return res
            .status(500)
            .json({ message: "Failed to start template generation" });
    }
};

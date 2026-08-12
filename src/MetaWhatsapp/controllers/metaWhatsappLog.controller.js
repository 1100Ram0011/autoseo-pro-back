import mongoose from "mongoose";
import MetaWhatsappLog from "../models/metaWhatsappLogSchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import { syncAndCacheAnalytics } from "../services/metaWhatsappAnalytics.service.js";
import logger from "../../config/logger.js";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const getPagination = (query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// ─── GET LOGS ─────────────────────────────────────────────────────────────────
// GET /api/meta/whatsapp/logs
// Query: { numberId, search, direction, messageType, status, paymentStatus, dateFrom, dateTo, campaignId, page, limit }

export const getLogs = async (req, res, next) => {
    try {
        const { page, limit, skip } = getPagination(req.query);
        const {
            numberId, search, direction, messageType,
            status, paymentStatus, dateFrom, dateTo, campaignId,
        } = req.query;

        const filter = { userId: req.user.id };

        if (numberId && mongoose.Types.ObjectId.isValid(numberId)) filter.numberId = numberId;
        if (direction) filter.direction = direction;
        if (messageType) filter.messageType = messageType;
        if (status) filter.status = status;
        if (campaignId && mongoose.Types.ObjectId.isValid(campaignId)) filter.campaignId = campaignId;

        if (paymentStatus === "paid") filter["pricing.billable"] = true;
        if (paymentStatus === "free") filter["pricing.billable"] = false;

        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = endDate;
            }
        }

        if (search) {
            const searchRegex = { $regex: search, $options: "i" };
            filter.$or = [
                { to: searchRegex },
                { from: searchRegex },
                { customerNumber: searchRegex },
                { metaMessageId: searchRegex },
                { templateName: searchRegex },
                { campaignName: searchRegex },
                { content: searchRegex },
                { whatsappNumber: searchRegex },
            ];
        }

        const [logs, total] = await Promise.all([
            MetaWhatsappLog.find(filter)
                .populate("numberId", "displayName phoneNumber")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            MetaWhatsappLog.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: logs,
            total,
            page,
            pageSize: limit,
            pages: Math.ceil(total / limit),
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET LOG BY ID ────────────────────────────────────────────────────────────
// GET /api/meta/whatsapp/logs/:id

export const getLogById = async (req, res, next) => {
    try {
        const log = await MetaWhatsappLog.findOne({
            _id: req.params.id,
            userId: req.user.id,
        })
            .populate("numberId", "displayName phoneNumber")
            .populate("campaignId", "name");

        if (!log) {
            return res.status(404).json({ success: false, message: "Log not found" });
        }

        res.json({ success: true, data: log });
    } catch (err) {
        next(err);
    }
};

// ─── GET LOG STATS ────────────────────────────────────────────────────────────
// GET /api/meta/whatsapp/logs/stats
// Query: { numberId, dateFrom, dateTo }

export const getLogStats = async (req, res, next) => {
    try {
        const { numberId, dateFrom, dateTo, phoneNumberId } = req.query;

        const stats = await MetaWhatsappLog.getStats(req.user.id, {
            numberId,
            phoneNumberId,
            dateFrom,
            dateTo,
        });

        res.json({ success: true, data: stats });
    } catch (err) {
        next(err);
    }
};

// ─── EXPORT LOGS (CSV) ───────────────────────────────────────────────────────
// POST /api/meta/whatsapp/logs/export
// Body: { numberId, search, direction, messageType, status, dateFrom, dateTo }

export const exportLogs = async (req, res, next) => {
    try {
        const {
            numberId, search, direction, messageType,
            status, dateFrom, dateTo,
        } = req.body;

        const filter = { userId: req.user.id };

        if (numberId && mongoose.Types.ObjectId.isValid(numberId)) filter.numberId = numberId;
        if (direction) filter.direction = direction;
        if (messageType) filter.messageType = messageType;
        if (status) filter.status = status;

        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = endDate;
            }
        }

        if (search) {
            const searchRegex = { $regex: search, $options: "i" };
            filter.$or = [
                { to: searchRegex },
                { from: searchRegex },
                { customerNumber: searchRegex },
                { metaMessageId: searchRegex },
                { templateName: searchRegex },
                { content: searchRegex },
            ];
        }

        const logs = await MetaWhatsappLog.find(filter)
            .populate("numberId", "displayName phoneNumber")
            .sort({ createdAt: -1 })
            .limit(10000) // Cap at 10K for export
            .lean();

        // Build CSV
        const headers = [
            "Date", "Time", "WhatsApp Number", "Direction", "Message Type",
            "Customer Number", "Template", "Campaign", "Status",
            "Sent At", "Delivered At", "Read At", "Error Code", "Error Message",
            "Origin", "Content", "Meta Message ID",
        ];

        const csvRows = [headers.join(",")];

        for (const log of logs) {
            const row = [
                log.createdAt ? new Date(log.createdAt).toLocaleDateString() : "",
                log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : "",
                `"${log.whatsappNumber || log.numberId?.phoneNumber || ""}"`,
                log.direction || "",
                log.messageType || "",
                `"${log.customerNumber || ""}"`,
                `"${log.templateName || ""}"`,
                `"${log.campaignName || ""}"`,
                log.status || "",
                log.sentAt ? new Date(log.sentAt).toISOString() : "",
                log.deliveredAt ? new Date(log.deliveredAt).toISOString() : "",
                log.readAt ? new Date(log.readAt).toISOString() : "",
                `"${log.errorCode || ""}"`,
                `"${(log.errorMessage || "").replace(/"/g, '""')}"`,
                log.origin || "",
                `"${(log.content || "").replace(/"/g, '""').substring(0, 100)}"`,
                log.metaMessageId || "",
            ];
            csvRows.push(row.join(","));
        }

        const csvContent = csvRows.join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="whatsapp-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csvContent);
    } catch (err) {
        next(err);
    }
};

// ─── GET ANALYTICS ────────────────────────────────────────────────────────────
// GET /api/meta/whatsapp/logs/analytics
// Query: { numberId, dateFrom, dateTo }

export const getAnalytics = async (req, res, next) => {
    try {
        const { numberId, dateFrom, dateTo } = req.query;

        // Default to last 30 days
        const end = dateTo ? new Date(dateTo) : new Date();
        const start = dateFrom ? new Date(dateFrom) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Find the WABA for this user
        const tokenFilter = { userId: req.user.id };
        if (numberId) tokenFilter._id = numberId;

        const token = await WhatsAppToken.findOne(tokenFilter).select("+accessToken").lean();

        if (!token) {
            return res.status(404).json({ success: false, message: "No WhatsApp number found" });
        }

        const analytics = await syncAndCacheAnalytics(
            req.user.id,
            token.wabaId,
            token.accessToken,
            start.toISOString(),
            end.toISOString(),
            "DAILY",
            false
        );

        res.json({ success: true, data: analytics });
    } catch (err) {
        next(err);
    }
};

// ─── SYNC ANALYTICS ──────────────────────────────────────────────────────────
// POST /api/meta/whatsapp/logs/analytics/sync
// Body: { numberId, dateFrom, dateTo }

export const syncAnalytics = async (req, res, next) => {
    try {
        const { numberId, dateFrom, dateTo } = req.body;

        const end = dateTo ? new Date(dateTo) : new Date();
        const start = dateFrom ? new Date(dateFrom) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        const tokenFilter = { userId: req.user.id };
        if (numberId) tokenFilter._id = numberId;

        const token = await WhatsAppToken.findOne(tokenFilter).select("+accessToken").lean();

        if (!token) {
            return res.status(404).json({ success: false, message: "No WhatsApp number found" });
        }

        const analytics = await syncAndCacheAnalytics(
            req.user.id,
            token.wabaId,
            token.accessToken,
            start.toISOString(),
            end.toISOString(),
            "DAILY",
            true // Force refresh
        );

        res.json({ success: true, message: "Analytics synced from Meta", data: analytics });
    } catch (err) {
        next(err);
    }
};

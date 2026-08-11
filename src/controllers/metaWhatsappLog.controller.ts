import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";
// Note: syncAndCacheAnalytics implementation should be in a service file in auto-seo-pro
// import { syncAndCacheAnalytics } from "../services/metaWhatsappAnalytics.service";

const prisma = new PrismaClient();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const getPagination = (query: any) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// ─── GET LOGS ─────────────────────────────────────────────────────────────────
// GET /api/meta-whatsapp/logs
export const getLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { page, limit, skip } = getPagination(req.query);
        const {
            numberId, search, direction, messageType,
            status, paymentStatus, dateFrom, dateTo, campaignId,
        } = req.query;

        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const filter: any = { userId };

        if (numberId) filter.numberId = String(numberId);
        if (direction) filter.direction = String(direction);
        if (messageType) filter.messageType = String(messageType);
        if (status) filter.status = String(status);
        if (campaignId) filter.campaignId = String(campaignId);

        // Note: pricing.billable logic might require joining or separate field in Prisma depending on schema
        // if (paymentStatus === "paid") filter["pricing.billable"] = true;
        // if (paymentStatus === "free") filter["pricing.billable"] = false;

        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.gte = new Date(dateFrom as string);
            if (dateTo) {
                const endDate = new Date(dateTo as string);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.lte = endDate;
            }
        }

        if (search) {
            const searchStr = String(search);
            filter.OR = [
                { to: { contains: searchStr, mode: 'insensitive' } },
                { from: { contains: searchStr, mode: 'insensitive' } },
                { customerNumber: { contains: searchStr, mode: 'insensitive' } },
                { messageId: { contains: searchStr, mode: 'insensitive' } },
                { templateName: { contains: searchStr, mode: 'insensitive' } },
                { campaignName: { contains: searchStr, mode: 'insensitive' } },
                { content: { contains: searchStr, mode: 'insensitive' } },
                { whatsappNumber: { contains: searchStr, mode: 'insensitive' } },
            ];
        }

        const [logs, total] = await Promise.all([
            prisma.whatsAppLog.findMany({
                where: filter,
                include: {
                    number: { select: { displayName: true, phoneNumber: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.whatsAppLog.count({ where: filter })
        ]);

        res.json({
            success: true,
            data: logs,
            total,
            page,
            pageSize: limit,
            pages: Math.ceil(total / limit),
        });
    } catch (err: any) {
        logger.error(`[Log Controller] Get logs error: ${err.message}`);
        next(err);
    }
};

// ─── GET LOG BY ID ────────────────────────────────────────────────────────────
export const getLogById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const log = await prisma.whatsAppLog.findFirst({
            where: {
                id: req.params.id as string,
                userId
            },
            include: {
                number: { select: { displayName: true, phoneNumber: true } },
                campaign: { select: { name: true } }
            }
        });

        if (!log) {
            return res.status(404).json({ success: false, message: "Log not found" });
        }

        res.json({ success: true, data: log });
    } catch (err) {
        next(err);
    }
};

// ─── GET LOG STATS ────────────────────────────────────────────────────────────
export const getLogStats = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { numberId, dateFrom, dateTo, phoneNumberId } = req.query;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        // Basic aggregation query for stats using Prisma
        const filter: any = { userId };
        if (numberId) filter.numberId = String(numberId);
        if (phoneNumberId) filter.phoneNumberId = String(phoneNumberId);
        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.gte = new Date(dateFrom as string);
            if (dateTo) {
                const endDate = new Date(dateTo as string);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.lte = endDate;
            }
        }

        const stats = await prisma.whatsAppLog.groupBy({
            by: ['status', 'direction', 'messageType'],
            where: filter,
            _count: { id: true }
        });

        // Restructure stats into a more UI-friendly format (similar to what mongoose schema method did)
        const formattedStats = {
            total: 0,
            delivered: 0,
            read: 0,
            failed: 0,
            inbound: 0,
            outbound: 0
        };

        stats.forEach(s => {
            formattedStats.total += s._count.id;
            if (s.status === 'delivered') formattedStats.delivered += s._count.id;
            if (s.status === 'read') formattedStats.read += s._count.id;
            if (s.status === 'failed') formattedStats.failed += s._count.id;
            if (s.direction === 'inbound') formattedStats.inbound += s._count.id;
            if (s.direction === 'outbound') formattedStats.outbound += s._count.id;
        });

        res.json({ success: true, data: formattedStats });
    } catch (err) {
        next(err);
    }
};

// ─── EXPORT LOGS (CSV) ───────────────────────────────────────────────────────
export const exportLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const {
            numberId, search, direction, messageType,
            status, dateFrom, dateTo,
        } = req.body;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const filter: any = { userId };

        if (numberId) filter.numberId = String(numberId);
        if (direction) filter.direction = String(direction);
        if (messageType) filter.messageType = String(messageType);
        if (status) filter.status = String(status);

        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.gte = new Date(dateFrom as string);
            if (dateTo) {
                const endDate = new Date(dateTo as string);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.lte = endDate;
            }
        }

        if (search) {
            const searchStr = String(search);
            filter.OR = [
                { to: { contains: searchStr, mode: 'insensitive' } },
                { from: { contains: searchStr, mode: 'insensitive' } },
                { customerNumber: { contains: searchStr, mode: 'insensitive' } },
                { messageId: { contains: searchStr, mode: 'insensitive' } },
                { templateName: { contains: searchStr, mode: 'insensitive' } },
                { content: { contains: searchStr, mode: 'insensitive' } },
            ];
        }

        const logs = await prisma.whatsAppLog.findMany({
            where: filter,
            include: {
                number: { select: { displayName: true, phoneNumber: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 10000 // Cap at 10K
        });

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
                `"${log.whatsappNumber || log.number?.phoneNumber || ""}"`,
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
                log.messageId || "",
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
export const getAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { numberId, dateFrom, dateTo } = req.query;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const end = dateTo ? new Date(dateTo as string) : new Date();
        const start = dateFrom ? new Date(dateFrom as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        const tokenFilter: any = { userId };
        if (numberId) tokenFilter.id = String(numberId);

        const token = await prisma.whatsAppToken.findFirst({
            where: tokenFilter
        });

        if (!token) {
            return res.status(404).json({ success: false, message: "No WhatsApp number found" });
        }

        // TODO: Implement syncAndCacheAnalytics logic using prisma
        // const analytics = await syncAndCacheAnalytics(
        //     userId,
        //     token.wabaId,
        //     token.accessToken,
        //     start.toISOString(),
        //     end.toISOString(),
        //     "DAILY",
        //     false
        // );

        res.json({ success: true, data: [] });
    } catch (err) {
        next(err);
    }
};

// ─── SYNC ANALYTICS ──────────────────────────────────────────────────────────
export const syncAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { numberId, dateFrom, dateTo } = req.body;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const end = dateTo ? new Date(dateTo) : new Date();
        const start = dateFrom ? new Date(dateFrom) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        const tokenFilter: any = { userId };
        if (numberId) tokenFilter.id = String(numberId);

        const token = await prisma.whatsAppToken.findFirst({
            where: tokenFilter
        });

        if (!token) {
            return res.status(404).json({ success: false, message: "No WhatsApp number found" });
        }

        // TODO: Implement syncAndCacheAnalytics logic using prisma
        res.json({ success: true, message: "Analytics synced from Meta (Placeholder)", data: [] });
    } catch (err) {
        next(err);
    }
};

import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getTemplateLibrary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const {
            category,
            topic,
            search,
            numberId,
            industry,
            language = 'en',
            page = 1,
            per_page = 100
        } = req.query;

        const pageNumber = parseInt(page as string, 10) || 1;
        const limitNumber = parseInt(per_page as string, 10) || 100;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        let userTokenDoc;
        if (numberId) {
            userTokenDoc = await prisma.whatsAppToken.findFirst({
                where: { id: String(numberId), userId }
            });
        } else {
            userTokenDoc = await prisma.whatsAppToken.findFirst({
                where: { userId, status: 'active' }
            });
        }

        if (!userTokenDoc || !userTokenDoc.accessToken) {
            return res.status(200).json({
                success: true,
                count: 0,
                data: [],
                meta: { current_page: pageNumber, per_page: limitNumber, total_items: 0, total_pages: 0 },
                message: "No connected WhatsApp Business Account credentials found."
            });
        }

        const params: any = {
            fields: "name,category,language,topic,industry,title,description,usecase,body,header,buttons,body_params,footer",
            limit: 100
        };

        if (search) params.name_or_content = search;
        if (category && category !== 'ALL') params.category = (category as string).toLowerCase();
        if (topic && topic !== 'ALL') params.topic = topic;
        if (industry && industry !== 'ALL') params.industry = industry;
        if (language) params.language = language;

        const response = await axios.get(`https://graph.facebook.com/v20.0/message_template_library`, {
            params,
            headers: {
                Authorization: `Bearer ${userTokenDoc.accessToken}`
            }
        });

        const rawTemplates = response.data.data || [];

        // Deduplicate and filter by exact language match
        const templatesMap = new Map();
        rawTemplates.forEach((t: any) => {
            const langMatch = t.language && t.language.toLowerCase().startsWith((language as string).toLowerCase());
            if (langMatch) {
                if (!templatesMap.has(t.name)) {
                    templatesMap.set(t.name, t);
                }
            }
        });

        let templates = Array.from(templatesMap.values());

        const allIndustries = new Set();
        templates.forEach(t => {
            if (Array.isArray(t.industry)) {
                t.industry.forEach((ind: string) => allIndustries.add(ind));
            }
        });

        if (category && category !== 'ALL') {
            const catUpper = (category as string).toUpperCase();
            templates = templates.filter(t => t.category?.toUpperCase() === catUpper);
        }
        if (topic && topic !== 'ALL') {
            const topicUpper = (topic as string).toUpperCase();
            templates = templates.filter(t => t.topic?.toUpperCase() === topicUpper);
        }
        if (industry && industry !== 'ALL') {
            const indUpper = (industry as string).toUpperCase();
            templates = templates.filter(t => t.industry?.some((ind: string) => ind.toUpperCase() === indUpper));
        }
        if (search) {
            const searchLower = (search as string).toLowerCase();
            templates = templates.filter(t =>
                (t.title && t.title.toLowerCase().includes(searchLower)) ||
                (t.name && t.name.toLowerCase().includes(searchLower)) ||
                (t.description && t.description.toLowerCase().includes(searchLower))
            );
        }

        const totalItems = templates.length;
        const totalPages = Math.ceil(totalItems / limitNumber);
        const startIndex = (pageNumber - 1) * limitNumber;
        const endIndex = startIndex + limitNumber;
        const paginatedTemplates = templates.slice(startIndex, endIndex);

        return res.status(200).json({
            success: true,
            count: paginatedTemplates.length,
            data: paginatedTemplates,
            industries: Array.from(allIndustries),
            meta: {
                current_page: pageNumber,
                per_page: limitNumber,
                total_pages: totalPages,
                total_items: totalItems
            }
        });
    } catch (err) {
        next(err);
    }
};

export const seedTemplateLibrary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        return res.status(200).json({
            success: true,
            message: "Seeding is disabled. Library templates are fetched directly from Meta's API.",
            data: []
        });
    } catch (err) {
        next(err);
    }
};

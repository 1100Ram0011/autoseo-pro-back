import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

/**
 * Helper: Generate a cryptographically secure API key
 * Returns { rawKey, hashedKey, keySuffix, displayKey }
 */
const generateSecureKey = () => {
    const rawKey = crypto.randomBytes(256).toString("hex");
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keySuffix = rawKey.slice(-16);
    const displayKey = rawKey;
    return { rawKey, hashedKey, keySuffix, displayKey };
};

/**
 * Helper: Parse expiresIn string to a Date or null
 * Accepts: "never" | "30d" | "60d" | "90d"
 */
const parseExpiry = (expiresIn: string | undefined): Date | null => {
    if (!expiresIn || expiresIn === "never") return null;

    const days: Record<string, number> = {
        "30d": 30,
        "60d": 60,
        "90d": 90,
    };

    const d = days[expiresIn];
    if (!d) return null;

    return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
};

// ─── LIST ALL API KEYS FOR CURRENT USER ───────────────────────
export const listApiKeys = async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const keys = await prisma.whatsAppApiKey.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        return res.status(200).json({
            status: "success",
            data: keys,
        });
    } catch (error: any) {
        logger.error(`[listApiKeys] Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
};

// ─── GENERATE A NEW API KEY ────────────────────────────────────
export const generateApiKey = async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        const { whatsappTokenId, expiresIn } = req.body;

        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        if (!whatsappTokenId) return res.status(400).json({ error: "whatsappTokenId is required." });

        const waToken = await prisma.whatsAppToken.findFirst({
            where: { id: whatsappTokenId, userId }
        });

        if (!waToken) {
            return res.status(404).json({ error: "WhatsApp number not found or does not belong to you." });
        }

        if (waToken.status !== "active") {
            return res.status(400).json({ error: "Cannot generate API key for an inactive WhatsApp number." });
        }

        const existingKey = await prisma.whatsAppApiKey.findFirst({
            where: {
                userId,
                whatsappTokenId,
                status: "active"
            }
        });

        if (existingKey) {
            return res.status(409).json({ error: "An active API key already exists for this number. Use Regenerate to create a new one." });
        }

        const { rawKey, hashedKey, keySuffix, displayKey } = generateSecureKey();
        const expiresAt = parseExpiry(expiresIn);

        const apiKeyDoc = await prisma.whatsAppApiKey.create({
            data: {
                userId,
                whatsappTokenId,
                phoneNumberId: waToken.phoneNumberId,
                phoneNumber: waToken.phoneNumber || "",
                apiKey: hashedKey,
                rawKey,
                keySuffix,
                displayKey,
                status: "active",
                expiresAt,
            }
        });

        return res.status(201).json({
            status: "success",
            message: "API key generated successfully.",
            data: {
                _id: apiKeyDoc.id,
                rawKey,
                phoneNumberId: apiKeyDoc.phoneNumberId,
                phoneNumber: apiKeyDoc.phoneNumber,
                displayKey: apiKeyDoc.displayKey,
                keySuffix: apiKeyDoc.keySuffix,
                status: apiKeyDoc.status,
                expiresAt: apiKeyDoc.expiresAt,
                createdAt: apiKeyDoc.createdAt,
            },
        });
    } catch (error: any) {
        logger.error(`[generateApiKey] Error: ${error.message}`);
        // Handle Prisma unique constraint violation code (P2002)
        if (error.code === 'P2002') {
            return res.status(409).json({
                error: "An active API key already exists for this number. Use Regenerate to create a new one.",
            });
        }
        return res.status(500).json({ error: error.message });
    }
};

// ─── REGENERATE AN API KEY ─────────────────────────────────────
export const regenerateApiKey = async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        const { id } = req.params;
        const { expiresIn } = req.body;

        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const existingKey = await prisma.whatsAppApiKey.findFirst({
            where: { id: id as string, userId }
        });

        if (!existingKey) {
            return res.status(404).json({ error: "API key not found or does not belong to you." });
        }

        await prisma.whatsAppApiKey.update({
            where: { id: existingKey.id },
            data: { status: "revoked" }
        });

        const { rawKey, hashedKey, keySuffix, displayKey } = generateSecureKey();
        const expiresAt = parseExpiry(expiresIn);

        const newApiKeyDoc = await prisma.whatsAppApiKey.create({
            data: {
                userId,
                whatsappTokenId: existingKey.whatsappTokenId,
                phoneNumberId: existingKey.phoneNumberId,
                phoneNumber: existingKey.phoneNumber,
                apiKey: hashedKey,
                rawKey,
                keySuffix,
                displayKey,
                status: "active",
                expiresAt,
            }
        });

        return res.status(201).json({
            status: "success",
            message: "API key regenerated successfully. The old key has been revoked.",
            data: {
                _id: newApiKeyDoc.id,
                rawKey,
                phoneNumberId: newApiKeyDoc.phoneNumberId,
                phoneNumber: newApiKeyDoc.phoneNumber,
                displayKey: newApiKeyDoc.displayKey,
                keySuffix: newApiKeyDoc.keySuffix,
                status: newApiKeyDoc.status,
                expiresAt: newApiKeyDoc.expiresAt,
                createdAt: newApiKeyDoc.createdAt,
            },
        });
    } catch (error: any) {
        logger.error(`[regenerateApiKey] Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
};

// ─── REVOKE AN API KEY ─────────────────────────────────────────
export const revokeApiKey = async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        const { id } = req.params;

        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const apiKeyDoc = await prisma.whatsAppApiKey.findFirst({
            where: { id: id as string, userId }
        });

        if (!apiKeyDoc) {
            return res.status(404).json({ error: "API key not found or does not belong to you." });
        }

        if (apiKeyDoc.status === "revoked") {
            return res.status(400).json({ error: "This API key is already revoked." });
        }

        await prisma.whatsAppApiKey.update({
            where: { id: apiKeyDoc.id },
            data: { status: "revoked" }
        });

        return res.status(200).json({
            status: "success",
            message: "API key has been revoked. Any integrations using this key will stop working immediately.",
        });
    } catch (error: any) {
        logger.error(`[revokeApiKey] Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
};

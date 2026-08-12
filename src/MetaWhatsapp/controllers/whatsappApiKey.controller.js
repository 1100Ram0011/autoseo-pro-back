import crypto from "crypto";
import WhatsAppApiKey from "../models/whatsappApiKeySchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";

/**
 * Helper: Generate a cryptographically secure API key
 * Returns { rawKey, hashedKey, keySuffix }
 */
const generateSecureKey = () => {
    // Pure 256-byte (512 hex chars) cryptographically secure random string — no prefix
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
const parseExpiry = (expiresIn) => {
    if (!expiresIn || expiresIn === "never") return null;

    const days = {
        "30d": 30,
        "60d": 60,
        "90d": 90,
    };

    const d = days[expiresIn];
    if (!d) return null;

    return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
};

// ─── LIST ALL API KEYS FOR CURRENT USER ───────────────────────
export const listApiKeys = async (req, res) => {
    try {
        const userId = req.user.id;
        const keys = await WhatsAppApiKey.findAllByUser(userId);

        return res.status(200).json({
            status: "success",
            data: keys,
        });
    } catch (error) {
        console.error("[listApiKeys] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
};

// ─── GENERATE A NEW API KEY ────────────────────────────────────
export const generateApiKey = async (req, res) => {
    try {
        const userId = req.user.id;
        const { whatsappTokenId, expiresIn } = req.body;

        if (!whatsappTokenId) {
            return res.status(400).json({ error: "whatsappTokenId is required." });
        }

        // Verify the WhatsApp number belongs to this user
        const waToken = await WhatsAppToken.findOne({
            _id: whatsappTokenId,
            userId,
        });

        if (!waToken) {
            return res.status(404).json({
                error: "WhatsApp number not found or does not belong to you.",
            });
        }

        if (waToken.status !== "active") {
            return res.status(400).json({
                error: "Cannot generate API key for an inactive WhatsApp number.",
            });
        }

        // Check if an active key already exists for this number
        const existingKey = await WhatsAppApiKey.findActiveByNumber(userId, whatsappTokenId);
        if (existingKey) {
            return res.status(409).json({
                error: "An active API key already exists for this number. Use Regenerate to create a new one.",
            });
        }

        // Generate the key
        const { rawKey, hashedKey, keySuffix, displayKey } = generateSecureKey();
        const expiresAt = parseExpiry(expiresIn);

        const apiKeyDoc = await WhatsAppApiKey.create({
            userId,
            whatsappTokenId,
            phoneNumberId: waToken.phoneNumberId,
            phoneNumber: waToken.phoneNumber,
            apiKey: hashedKey,
            rawKey,
            keySuffix,
            displayKey,
            status: "active",
            expiresAt,
        });

        return res.status(201).json({
            status: "success",
            message: "API key generated successfully.",
            data: {
                _id: apiKeyDoc._id,
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
    } catch (error) {
        console.error("[generateApiKey] Error:", error.message);

        // Handle duplicate key constraint (race condition)
        if (error.code === 11000) {
            return res.status(409).json({
                error: "An active API key already exists for this number. Use Regenerate to create a new one.",
            });
        }

        return res.status(500).json({ error: error.message });
    }
};

// ─── REGENERATE AN API KEY ─────────────────────────────────────
export const regenerateApiKey = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { expiresIn } = req.body;

        // Find and verify ownership
        const existingKey = await WhatsAppApiKey.findOne({ _id: id, userId });
        if (!existingKey) {
            return res.status(404).json({
                error: "API key not found or does not belong to you.",
            });
        }

        // Revoke the old key
        existingKey.status = "revoked";
        await existingKey.save();

        // Generate a new key for the same number
        const { rawKey, hashedKey, keySuffix, displayKey } = generateSecureKey();
        const expiresAt = parseExpiry(expiresIn);

        const newApiKeyDoc = await WhatsAppApiKey.create({
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
        });

        return res.status(201).json({
            status: "success",
            message: "API key regenerated successfully. The old key has been revoked.",
            data: {
                _id: newApiKeyDoc._id,
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
    } catch (error) {
        console.error("[regenerateApiKey] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
};

// ─── REVOKE AN API KEY ─────────────────────────────────────────
export const revokeApiKey = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const apiKeyDoc = await WhatsAppApiKey.findOne({ _id: id, userId });
        if (!apiKeyDoc) {
            return res.status(404).json({
                error: "API key not found or does not belong to you.",
            });
        }

        if (apiKeyDoc.status === "revoked") {
            return res.status(400).json({
                error: "This API key is already revoked.",
            });
        }

        apiKeyDoc.status = "revoked";
        await apiKeyDoc.save();

        return res.status(200).json({
            status: "success",
            message: "API key has been revoked. Any integrations using this key will stop working immediately.",
        });
    } catch (error) {
        console.error("[revokeApiKey] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
};

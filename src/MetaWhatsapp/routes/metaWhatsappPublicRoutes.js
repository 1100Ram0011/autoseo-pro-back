import express from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redisClient from "../../config/redis.js";
import { apiKeyAuth } from "../../middleware/apiKeyAuth.middleware.js";
import { publicSendTemplate, publicSendInteractive } from "../controllers/metaWhatsappPublic.controller.js";

const metaWhatsappPublicRouter = express.Router();

// ── Rate Limiter: 100 req / 10 min per API key ───────────────
const publicApiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 100,
    message: {
        error: "Rate limit exceeded. Maximum 100 requests per 10 minutes. Please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Key by API key hash (from x-api-key header), not IP
    keyGenerator: (req) => {
        const rawKey = req.headers["x-api-key"] || "";
        // Use a simple prefix + first 16 chars to keep the key short for Redis
        return `wa-pub:${rawKey.slice(0, 16)}`;
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: "rl:wa-pub:",
    }),
});

// ── Apply middleware to all public routes ──────────────────────
metaWhatsappPublicRouter.use(publicApiLimiter);
metaWhatsappPublicRouter.use(apiKeyAuth);

// ── Public API Endpoints ──────────────────────────────────────
metaWhatsappPublicRouter.post("/send-template", publicSendTemplate);
metaWhatsappPublicRouter.post("/send-interactive", publicSendInteractive);

export default metaWhatsappPublicRouter;

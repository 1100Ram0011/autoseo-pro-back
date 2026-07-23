"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ai_controller_1 = require("../controllers/ai.controller");
const rateLimit_1 = require("../middlewares/rateLimit");
const router = (0, express_1.Router)();
router.post('/keywords', rateLimit_1.aiLimiter, ai_controller_1.generateAiKeywords);
router.post('/blog', rateLimit_1.aiLimiter, ai_controller_1.generateAiBlog);
router.post('/schema', rateLimit_1.aiLimiter, ai_controller_1.generateAiSchema);
router.post('/analyze-site', rateLimit_1.aiLimiter, ai_controller_1.generateAiAnalysis);
router.post('/chat', rateLimit_1.aiLimiter, ai_controller_1.generateAiChat);
exports.default = router;
//# sourceMappingURL=ai.routes.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gmb_controller_1 = require("../controllers/gmb.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// Mounted at /api/sites/:id/gmb
router.post('/sync', gmb_controller_1.syncProfile);
router.get('/reviews', gmb_controller_1.getReviews);
router.post('/reviews/:reviewId/ai-reply', gmb_controller_1.generateAiReply);
router.post('/reviews/:reviewId/publish', gmb_controller_1.publishReply);
exports.default = router;
//# sourceMappingURL=gmb.routes.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const business_controller_1 = require("../controllers/business.controller");
const router = (0, express_1.Router)();
router.post('/connect', business_controller_1.connectBusiness);
router.get('/profile', business_controller_1.getBusinessProfile);
router.post('/generate-post', business_controller_1.generateDailyPost);
router.post('/publish', business_controller_1.publishPost);
router.get('/reviews', business_controller_1.getReviews);
router.post('/generate-reply', business_controller_1.generateReviewReply);
exports.default = router;
//# sourceMappingURL=business.routes.js.map
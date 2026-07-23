"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const analytics_controller_1 = require("../controllers/analytics.controller");
const router = (0, express_1.Router)();
router.get('/sites/:id/ga4/overview', analytics_controller_1.getGa4Overview);
router.get('/sites/:id/ga4/pages', analytics_controller_1.getGa4Pages);
router.get('/analytics/:siteId', analytics_controller_1.getAnalytics);
router.post('/track', analytics_controller_1.trackVisitor);
exports.default = router;
//# sourceMappingURL=analytics.routes.js.map
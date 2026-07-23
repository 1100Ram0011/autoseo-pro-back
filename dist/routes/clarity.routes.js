"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const clarity_controller_1 = require("../controllers/clarity.controller");
const router = (0, express_1.Router)();
router.get('/sites/:siteId/clarity/issues', clarity_controller_1.getUxIssues);
router.get('/sites/:siteId/clarity/metrics', clarity_controller_1.getHistoricalMetrics);
router.post('/clarity/sync', clarity_controller_1.triggerManualSync);
exports.default = router;
//# sourceMappingURL=clarity.routes.js.map
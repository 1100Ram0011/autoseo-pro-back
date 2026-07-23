"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const alerts_controller_1 = require("../controllers/alerts.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// Existing generic route
router.get('/smart', alerts_controller_1.getSmartAlerts);
// New Routes mounted at /api/sites/:id/alerts
router.get('/', alerts_controller_1.getAlerts);
router.post('/mark-read', alerts_controller_1.markAsRead);
router.post('/simulate-uptime', alerts_controller_1.simulateUptimeCheck);
exports.default = router;
//# sourceMappingURL=alerts.routes.js.map
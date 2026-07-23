"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const anomaly_controller_1 = require("../controllers/anomaly.controller");
const router = (0, express_1.Router)();
router.get('/:siteId', anomaly_controller_1.getAnomalies);
router.post('/execute', anomaly_controller_1.executeAction);
router.post('/:siteId/scan', anomaly_controller_1.triggerScan);
exports.default = router;
//# sourceMappingURL=anomaly.routes.js.map
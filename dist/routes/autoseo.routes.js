"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const autoseo_controller_1 = require("../controllers/autoseo.controller");
const router = (0, express_1.Router)();
router.post('/autoseo/scan', autoseo_controller_1.startScan);
router.get('/autoseo/stream/:reportId', autoseo_controller_1.streamProgress);
router.get('/autoseo/report/:reportId', autoseo_controller_1.getReport);
exports.default = router;
//# sourceMappingURL=autoseo.routes.js.map
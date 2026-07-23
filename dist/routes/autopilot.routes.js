"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const autopilot_controller_1 = require("../controllers/autopilot.controller");
const router = (0, express_1.Router)();
router.get('/stream', autopilot_controller_1.runAutoPilotStream);
exports.default = router;
//# sourceMappingURL=autopilot.routes.js.map
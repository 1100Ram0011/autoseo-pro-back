"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agents_controller_1 = require("../controllers/agents.controller");
const router = (0, express_1.Router)();
router.post('/w1', agents_controller_1.runAgentW1);
router.post('/w2', agents_controller_1.runAgentW2);
router.post('/w3', agents_controller_1.runAgentW3);
exports.default = router;
//# sourceMappingURL=agents.routes.js.map
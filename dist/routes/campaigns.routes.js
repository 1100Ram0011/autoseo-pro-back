"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const campaigns_controller_1 = require("../controllers/campaigns.controller");
const router = (0, express_1.Router)();
router.get('/', campaigns_controller_1.getCampaigns);
exports.default = router;
//# sourceMappingURL=campaigns.routes.js.map
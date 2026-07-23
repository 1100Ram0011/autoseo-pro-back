"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const competitors_controller_1 = require("../controllers/competitors.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// Mounted at /api/sites/:id/competitors
router.get('/', competitors_controller_1.getCompetitors);
router.post('/', competitors_controller_1.addCompetitor);
router.delete('/:competitorId', competitors_controller_1.deleteCompetitor);
exports.default = router;
//# sourceMappingURL=competitors.routes.js.map
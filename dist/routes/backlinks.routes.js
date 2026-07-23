"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const backlinks_controller_1 = require("../controllers/backlinks.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// Mounted at /api/sites/:id/backlinks
router.post('/scan', backlinks_controller_1.scanBacklinks);
router.get('/', backlinks_controller_1.getBacklinks);
router.patch('/:linkId/disavow', backlinks_controller_1.markDisavow);
router.get('/export-disavow', backlinks_controller_1.generateDisavow);
exports.default = router;
//# sourceMappingURL=backlinks.routes.js.map
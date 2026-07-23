"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const links_controller_1 = require("../controllers/links.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// Mounted at /api/sites/:id/internal-links
router.get('/', links_controller_1.getSuggestions);
router.post('/generate', links_controller_1.generateSuggestions);
router.patch('/:suggestionId', links_controller_1.updateSuggestionStatus);
exports.default = router;
//# sourceMappingURL=links.routes.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const keywords_controller_1 = require("../controllers/keywords.controller");
const router = (0, express_1.Router)();
router.get('/sites/:id/keywords', keywords_controller_1.getSiteKeywords);
router.post('/sites/:id/keywords', keywords_controller_1.createSiteKeyword);
router.delete('/keywords/:keywordId', keywords_controller_1.deleteKeyword);
router.get('/sites/:id/keyword-ideas', keywords_controller_1.getKeywordIdeas);
exports.default = router;
//# sourceMappingURL=keywords.routes.js.map
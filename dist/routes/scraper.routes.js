"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const scraper_controller_1 = require("../controllers/scraper.controller");
const router = (0, express_1.Router)();
router.post('/start', scraper_controller_1.startScrapeJob);
router.get('/status/:jobId', scraper_controller_1.checkJobStatus);
exports.default = router;
//# sourceMappingURL=scraper.routes.js.map
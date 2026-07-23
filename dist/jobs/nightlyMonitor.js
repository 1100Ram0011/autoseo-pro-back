"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initNightlyMonitor = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../config/prisma"));
const anomalyDetector_1 = require("../services/anomalyDetector");
const initNightlyMonitor = () => {
    // Run every night at 12:00 AM
    node_cron_1.default.schedule('0 0 * * *', async () => {
        console.log('[Cron] Starting Nightly AI Anomaly Monitor...');
        try {
            const sites = await prisma_1.default.site.findMany();
            for (const site of sites) {
                console.log(`[Cron] Analyzing site: ${site.url}`);
                await (0, anomalyDetector_1.runAnomalyDetection)(site.id);
            }
            console.log('[Cron] Nightly Monitor completed successfully.');
        }
        catch (error) {
            console.error('[Cron] Error running Nightly Monitor:', error);
        }
    });
    console.log('🕰️ AI Anomaly Monitor Cron Job scheduled for 12:00 AM daily.');
};
exports.initNightlyMonitor = initNightlyMonitor;
//# sourceMappingURL=nightlyMonitor.js.map
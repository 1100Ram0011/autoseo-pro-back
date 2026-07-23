"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const routes_1 = __importDefault(require("./routes"));
const claritySync_1 = require("./services/claritySync");
const nightlyMonitor_1 = require("./jobs/nightlyMonitor");
require("./jobs/leadsQueue");
require("./jobs/linkedinQueue");
require("./jobs/whatsappValidationQueue");
require("./jobs/firecrawlQueue");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
// --- CORS: Only allow known origins ---
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.FRONTEND_URL,
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.) in dev
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error(`CORS blocked: ${origin}`));
        }
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
// --- Request Logger ---
app.use((req, _res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});
// Initialize Cron Jobs
(0, claritySync_1.initClarityCron)();
(0, nightlyMonitor_1.initNightlyMonitor)();
// Basic health check route
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'AutoSEO Pro Backend is running' });
});
// Register API Routes
app.use('/api', routes_1.default);
// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';
    console.error(`[ERROR] ${statusCode}: ${message}`);
    if (process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
    }
    res.status(statusCode).json({
        error: {
            message,
            code: err.code || 'INTERNAL_ERROR',
            ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
        },
    });
});
// Start the server
app.listen(port, () => {
    console.log(`🚀 AutoSEO Pro Backend running on port ${port}`);
    console.log(`   CORS: ${allowedOrigins.join(', ')}`);
});
//# sourceMappingURL=index.js.map
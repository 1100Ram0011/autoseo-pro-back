"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateUptimeCheck = exports.markAsRead = exports.getAlerts = exports.getSmartAlerts = void 0;
const genai_1 = require("@google/genai");
const prisma_1 = __importDefault(require("../config/prisma"));
const getSmartAlerts = async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
    const ai = new genai_1.GoogleGenAI({ apiKey });
    const simulatedAnomaly = 'Website: rajeshfurniture.com\nAnomaly: Organic traffic to the \'/products/wooden-sofa\' page dropped by 42% over the last 48 hours.\nTechnical observations:\n- Page Load Time increased from 1.2s to 4.5s.\n- Meta Description is missing.\n- Microsoft Clarity shows a 60% increase in Rage Clicks on the \'Add to Cart\' button.';
    const prompt = 'You are an Expert SEO Analyst. Analyze the following website anomaly data.\nProvide a concise, JSON-formatted response with the following structure:\n{\n  "title": "A catchy, urgent title for the alert",\n  "reason": "1-2 sentences explaining why this happened based on the data",\n  "fixes": ["Actionable step 1", "Actionable step 2", "Actionable step 3"]\n}\n\nData:\n' + simulatedAnomaly + '\n\nEnsure your response is ONLY valid JSON.';
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
            }
        });
        const resultText = response.text;
        if (resultText) {
            const alertData = JSON.parse(resultText);
            return res.json({ success: true, alert: alertData });
        }
        return res.status(500).json({ error: 'Empty response from Gemini' });
    }
    catch (error) {
        console.error('Gemini API Error:', error);
        // Fallback if API fails
        return res.json({
            success: true,
            alert: {
                title: "Critical Traffic Drop on /products/wooden-sofa",
                reason: "Page speed issues and missing meta description are severely impacting rankings, while UI bugs are causing user frustration.",
                fixes: ["Optimize image sizes to improve page speed.", "Add a compelling meta description.", "Debug the Add to Cart button to resolve rage clicks."]
            }
        });
    }
};
exports.getSmartAlerts = getSmartAlerts;
const getAlerts = async (req, res) => {
    try {
        const siteId = req.params.id;
        const alerts = await prisma_1.default.alert.findMany({
            where: { siteId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(alerts);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
};
exports.getAlerts = getAlerts;
const markAsRead = async (req, res) => {
    try {
        const siteId = req.params.id;
        const { alertId } = req.body; // if alertId is provided, mark one. else mark all.
        if (alertId) {
            await prisma_1.default.alert.update({
                where: { id: alertId },
                data: { isRead: true }
            });
        }
        else {
            await prisma_1.default.alert.updateMany({
                where: { siteId },
                data: { isRead: true }
            });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update alert status' });
    }
};
exports.markAsRead = markAsRead;
const simulateUptimeCheck = async (req, res) => {
    try {
        const siteId = req.params.id;
        // MVP: Simulate creating a critical downtime alert
        const newAlert = await prisma_1.default.alert.create({
            data: {
                siteId,
                type: 'critical',
                title: 'Website Down (HTTP 503)',
                description: 'Your server is responding with a 503 Service Unavailable error. Immediate action required.',
                source: 'UPTIME'
            }
        });
        // Simulate sending WhatsApp/Email
        console.log(`[SIMULATION] Sending WhatsApp alert to admin for site ${siteId}`);
        console.log(`[SIMULATION] Sending Email alert to admin for site ${siteId}`);
        res.json({
            success: true,
            alert: newAlert,
            message: 'Uptime check failed. Alert sent via WhatsApp and Email.'
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to simulate uptime check' });
    }
};
exports.simulateUptimeCheck = simulateUptimeCheck;
//# sourceMappingURL=alerts.controller.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const autoSeoEngine_1 = require("../src/services/autoSeoEngine");
(0, vitest_1.describe)('AutoSeoEngine', () => {
    (0, vitest_1.it)('should initialize correctly with required args', () => {
        const engine = new autoSeoEngine_1.AutoSeoEngine('report-1', 'site-123', 'user-456', 'https://example.com');
        (0, vitest_1.expect)(engine).toBeDefined();
    });
    (0, vitest_1.it)('should emit events correctly during the lifecycle', () => {
        const engine = new autoSeoEngine_1.AutoSeoEngine('report-2', 'site-123', 'user-456', 'https://example.com');
        const onEvent = vitest_1.vi.fn();
        autoSeoEngine_1.autoSeoEmitter.on('update-report-2', onEvent);
        // @ts-ignore - emit is private but we test its effect
        engine.emit('ga', 'running', 'Fetching Google Analytics data');
        (0, vitest_1.expect)(onEvent).toHaveBeenCalledWith({ step: 'ga', status: 'running', message: 'Fetching Google Analytics data' });
    });
});
//# sourceMappingURL=autoSeoEngine.test.js.map
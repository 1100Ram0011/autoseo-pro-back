import { describe, it, expect, vi } from 'vitest';
import { AutoSeoEngine, autoSeoEmitter } from '../src/services/autoSeoEngine';

describe('AutoSeoEngine', () => {
  it('should initialize correctly with required args', () => {
    const engine = new AutoSeoEngine('report-1', 'site-123', 'user-456', 'https://example.com');
    expect(engine).toBeDefined();
  });

  it('should emit events correctly during the lifecycle', () => {
    const engine = new AutoSeoEngine('report-2', 'site-123', 'user-456', 'https://example.com');
    const onEvent = vi.fn();
    
    autoSeoEmitter.on('update-report-2', onEvent);
    // @ts-ignore - emit is private but we test its effect
    engine.emit('ga', 'running', 'Fetching Google Analytics data');

    expect(onEvent).toHaveBeenCalledWith({ step: 'ga', status: 'running', message: 'Fetching Google Analytics data' });
  });
});

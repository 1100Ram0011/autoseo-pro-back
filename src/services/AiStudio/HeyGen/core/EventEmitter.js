/**
 * HeyGen Core Event Emitter Wrapper
 */

import { EventEmitter as NodeEventEmitter } from "events";

export class HeyGenEventEmitter extends NodeEventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitEvent(eventName, payload) {
    this.emit(eventName, {
      event: eventName,
      timestamp: new Date().toISOString(),
      data: payload,
    });
  }

  onEvent(eventName, handler) {
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }
}

export default HeyGenEventEmitter;

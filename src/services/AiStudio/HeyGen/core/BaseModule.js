/**
 * HeyGen Base Module Class
 */

import { HeyGenValidationError } from "../errors.js";

export class BaseModule {
  constructor(client, events) {
    if (!client) {
      throw new HeyGenValidationError("BaseModule requires a HeyGen client instance.");
    }
    this.client = client;
    this.http = client.http;
    this.events = events || client.events;
  }

  emit(eventName, payload) {
    if (this.events) {
      this.events.emitEvent(eventName, payload);
    }
  }
}

export default BaseModule;

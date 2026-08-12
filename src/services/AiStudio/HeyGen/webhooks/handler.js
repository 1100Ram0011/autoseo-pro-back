/**
 * HeyGen Webhook Event Handler & Router
 */

import { verifyWebhookSignature } from "./verify.js";
import { parseWebhookPayload } from "./parser.js";
import { HeyGenWebhookError } from "../errors.js";

export class WebhookHandler {
  constructor(options = {}) {
    this.secret = options.secret;
    this.handlers = new Map();
  }

  on(eventType, callback) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(callback);
    return this;
  }

  async handle(req, res = null) {
    const signature = req.headers["x-heygen-signature"] || req.headers["signature"];
    const rawBody = req.body;

    if (this.secret && !verifyWebhookSignature(rawBody, signature, this.secret)) {
      throw new HeyGenWebhookError("Invalid webhook signature verification.");
    }

    const parsed = parseWebhookPayload(rawBody);

    const specificCallbacks = this.handlers.get(parsed.eventType) || [];
    const wildcardCallbacks = this.handlers.get("*") || [];

    const callbacks = [...specificCallbacks, ...wildcardCallbacks];

    for (const callback of callbacks) {
      await callback(parsed);
    }

    if (res && typeof res.status === "function") {
      res.status(200).json({ received: true, event: parsed.eventType });
    }

    return parsed;
  }
}

export default WebhookHandler;

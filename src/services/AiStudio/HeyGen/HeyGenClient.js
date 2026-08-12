/**
 * HeyGen Main SDK Client
 */

import HttpClient from "./core/HttpClient.js";
import HeyGenEventEmitter from "./core/EventEmitter.js";

// Import All Feature Modules
import AvatarModule from "./modules/Avatar.js";
import VideoModule from "./modules/Video.js";
import VoiceModule from "./modules/Voice.js";
import VoiceCloneModule from "./modules/VoiceClone.js";
import CinematicModule from "./modules/Cinematic.js";
import AssetsModule from "./modules/Assets.js";
import TranslationModule from "./modules/Translation.js";
import StreamingModule from "./modules/Streaming.js";
import InteractiveModule from "./modules/Interactive.js";
import TemplatesModule from "./modules/Templates.js";
import BrandKitModule from "./modules/BrandKit.js";
import DigitalTwinModule from "./modules/DigitalTwin.js";
import AgentModule from "./modules/Agent.js";
import LipsyncModule from "./modules/Lipsync.js";

// Import Webhook Handler
import WebhookHandler from "./webhooks/handler.js";

export class HeyGenClient {
  constructor(options = {}) {
    this.events = new HeyGenEventEmitter();
    this.http = new HttpClient(options);

    // Initialize Sub-Modules
    this.avatar = new AvatarModule(this, this.events);
    this.video = new VideoModule(this, this.events);
    this.voice = new VoiceModule(this, this.events);
    this.voiceClone = new VoiceCloneModule(this, this.events);
    this.cinematic = new CinematicModule(this, this.events);
    this.assets = new AssetsModule(this, this.events);
    this.translation = new TranslationModule(this, this.events);
    this.streaming = new StreamingModule(this, this.events);
    this.interactive = new InteractiveModule(this, this.events);
    this.templates = new TemplatesModule(this, this.events);
    this.brandKit = new BrandKitModule(this, this.events);
    this.digitalTwin = new DigitalTwinModule(this, this.events);
    this.agent = new AgentModule(this, this.events);
    this.lipsync = new LipsyncModule(this, this.events);

    // Webhook Utilities
    this.webhooks = new WebhookHandler({ secret: options.webhookSecret });
  }

  setApiKey(apiKey) {
    this.http.setApiKey(apiKey);
  }

  on(eventName, handler) {
    return this.events.onEvent(eventName, handler);
  }
}

export default HeyGenClient;

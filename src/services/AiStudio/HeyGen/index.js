/**
 * HeyGen Module Entry Point
 */

import HeyGenClient from "./HeyGenClient.js";

// Export Core Layer
export { HttpClient } from "./core/HttpClient.js";
export { BaseModule } from "./core/BaseModule.js";
export { executeWithRetry } from "./core/Retry.js";
export { Poller } from "./core/Polling.js";
export { UploadHandler } from "./core/Upload.js";
export { Utils } from "./core/Utils.js";
export { HeyGenEventEmitter } from "./core/EventEmitter.js";

// Export Helpers Layer
export { AvatarHelper } from "./helpers/AvatarHelper.js";
export { VideoHelper, DEFAULT_MOTION_PROMPT, DEFAULT_ENGINE } from "./helpers/VideoHelper.js";
export { VoiceHelper } from "./helpers/VoiceHelper.js";
export { PromptHelper } from "./helpers/PromptHelper.js";
export { SceneHelper } from "./helpers/SceneHelper.js";

// Export Feature Modules
export { AvatarModule } from "./modules/Avatar.js";
export { VideoModule } from "./modules/Video.js";
export { VoiceModule } from "./modules/Voice.js";
export { VoiceCloneModule } from "./modules/VoiceClone.js";
export { CinematicModule } from "./modules/Cinematic.js";
export { AssetsModule } from "./modules/Assets.js";
export { TranslationModule } from "./modules/Translation.js";
export { StreamingModule } from "./modules/Streaming.js";
export { InteractiveModule } from "./modules/Interactive.js";
export { TemplatesModule } from "./modules/Templates.js";
export { BrandKitModule } from "./modules/BrandKit.js";
export { DigitalTwinModule } from "./modules/DigitalTwin.js";
export { AgentModule } from "./modules/Agent.js";
export { LipsyncModule } from "./modules/Lipsync.js";

// Export Webhook Utilities
export { verifyWebhookSignature } from "./webhooks/verify.js";
export { parseWebhookPayload } from "./webhooks/parser.js";
export { WebhookHandler } from "./webhooks/handler.js";

// Export Configuration & Constants
export { defaultConfig } from "./config.js";
export * as constants from "./constants.js";
export * as errors from "./errors.js";

export { HeyGenClient };
export default HeyGenClient;

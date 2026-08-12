/**
 * HeyGen Integration Constants and Enums
 */

export const API_ENDPOINTS = {
  // Avatars & Avatar Looks (v3 primary, v2 fallback)
  LIST_AVATARS: "/v3/avatars",
  AVATAR_DETAILS: "/v3/avatars",
  AVATAR_GROUPS: "/v3/avatars/groups",
  AVATAR_GROUPS_V2: "/v2/avatar_group/list",
  AVATAR_LOOKS: "/v3/avatars/looks",
  CREATE_AVATAR: "/v3/avatars",
  CREATE_PHOTO_AVATAR: "/v3/avatars",
  CREATE_PHOTO_AVATAR_V2: "/v2/photo_avatar",
  
  // Video Generation (v3 primary, v2/v1 fallback)
  GENERATE_VIDEO: "/v3/videos",
  GENERATE_VIDEO_V2: "/v2/video/generate",
  VIDEO_STATUS: "/v3/videos",
  VIDEO_STATUS_V1: "/v1/video_status.get",
  LIST_VIDEOS: "/v3/videos",
  DELETE_VIDEO: "/v3/videos",
  
  // Cinematic Avatar
  GENERATE_CINEMATIC: "/v2/cinematic/generate",
  CINEMATIC_STATUS: "/v2/cinematic/status",
  
  // Voices & Voice Cloning (v3 primary, v2 fallback)
  LIST_VOICES: "/v3/voices",
  VOICE_DETAILS: "/v3/voices",
  VOICE_CLONE_INSTANT: "/v3/voices/clone",
  VOICE_CLONE_INSTANT_V2: "/v2/voice/clone/instant",
  VOICE_CLONE_STATUS: "/v3/voices",
  VOICE_CLONE_STATUS_V2: "/v2/voice/clone/status",
  VOICE_SPEECH: "/v3/voices/speech",
  
  // Assets & Batches (v3 primary, v2 fallback)
  UPLOAD_ASSET: "/v3/assets",
  ASSETS_DIRECT_UPLOAD: "/v3/assets/direct-uploads",
  ASSETS_BATCH_UPLOAD: "/v3/assets/direct-uploads/batches",
  ASSETS_STATUSES: "/v3/assets/statuses",
  ASSETS_BATCHES: "/v3/assets/batches",
  UPLOAD_ASSET_V2: "/v2/asset/upload",
  LIST_ASSETS: "/v3/assets",
  ASSET_INFO: "/v3/assets",
  DELETE_ASSET: "/v3/assets",

  // Video Translation (v3 primary)
  TRANSLATE_VIDEO: "/v3/video_translations/batches",
  TRANSLATION_STATUS: "/v3/video_translations/batches",
  LIST_TRANSLATIONS: "/v3/video_translations/batches",

  // Lipsync (v3 primary)
  CREATE_LIPSYNC: "/v3/lipsyncs",
  GET_LIPSYNC: "/v3/lipsyncs",
  LIST_LIPSYNCS: "/v3/lipsyncs",
  UPDATE_LIPSYNC: "/v3/lipsyncs",
  DELETE_LIPSYNC: "/v3/lipsyncs",

  // Live Streaming & Interactive Avatar
  STREAMING_CREATE_SESSION: "/v1/streaming.new",
  STREAMING_START_SESSION: "/v1/streaming.start",
  STREAMING_SEND_SDP: "/v1/streaming.offer",
  STREAMING_SEND_ICE: "/v1/streaming.ice",
  STREAMING_SEND_TASK: "/v1/streaming.task",
  STREAMING_STOP_SESSION: "/v1/streaming.stop",
  
  // Interactive Agent & Video Agent (v3 primary)
  CREATE_VIDEO_AGENT: "/v3/video-agents",
  VIDEO_AGENT_STATUS: "/v3/video-agents",
  VIDEO_AGENT_CREATE_SESSION: "/v3/video_agent/session",
  VIDEO_AGENT_CHAT: "/v3/video_agent/chat",
  VIDEO_AGENT_STYLES: "/v3/video_agent/styles",
  AGENT_CREATE_SESSION: "/v3/video_agent/session",
  AGENT_SEND_MESSAGE: "/v3/video_agent/chat",
  AGENT_STOP_SESSION: "/v3/video_agent/session",

  // Templates
  LIST_TEMPLATES: "/v2/templates",
  TEMPLATE_DETAILS: "/v2/template",
  GENERATE_FROM_TEMPLATE: "/v2/template/generate",

  // Brand Kit
  BRAND_KIT: "/v3/brand_kits",
  BRAND_GLOSSARIES: "/v3/brand_glossaries",

  // Digital Twin (v3 primary)
  DIGITAL_TWIN_CREATE: "/v3/avatars",
  DIGITAL_TWIN_STATUS: "/v3/avatars",
  DIGITAL_TWIN_VERIFY: "/v3/avatars",

  // Agent
  VIDEO_AGENT_GENERATE: "/v3/video-agents",
};

export const VIDEO_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  WAITING: "waiting",
};

export const ASPECT_RATIOS = {
  LANDSCAPE: "16:9",
  PORTRAIT: "9:16",
  SQUARE: "1:1",
};

export const DIMENSIONS = {
  LANDSCAPE_1080P: { width: 1920, height: 1080 },
  LANDSCAPE_720P: { width: 1280, height: 720 },
  PORTRAIT_1080P: { width: 1080, height: 1920 },
  SQUARE_1080P: { width: 1080, height: 1080 },
};

export const QUALITY_PRESETS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export const WEBHOOK_EVENTS = {
  AVATAR_VIDEO_SUCCESS: "avatar_video.success",
  AVATAR_VIDEO_FAILED: "avatar_video.failed",
  CINEMATIC_VIDEO_SUCCESS: "cinematic_video.success",
  CINEMATIC_VIDEO_FAILED: "cinematic_video.failed",
  VOICE_CLONE_SUCCESS: "voice_clone.success",
  VOICE_CLONE_FAILED: "voice_clone.failed",
  TRANSLATION_SUCCESS: "video_translation.success",
  TRANSLATION_FAILED: "video_translation.failed",
  DIGITAL_TWIN_TRAINED: "digital_twin.trained",
  DIGITAL_TWIN_FAILED: "digital_twin.failed",
};

export default {
  API_ENDPOINTS,
  VIDEO_STATUS,
  ASPECT_RATIOS,
  DIMENSIONS,
  QUALITY_PRESETS,
  WEBHOOK_EVENTS,
};

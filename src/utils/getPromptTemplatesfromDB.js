import PixversePromptTemplate from '../models/Pixverse/Pixverseprompttemplate.model.js';
import mongoose from 'mongoose';

/**
 * Fetches approved, public prompt templates from DB
 * and shapes them to match the PIXVERSE_VIDEO_TEMPLATES array format
 * that the frontend and PixVerseVideoService expect.
 */
export const getPromptTemplatesFromDB = async () => {
  const docs = await PixversePromptTemplate.find({
    isApproved: true,
    isPublic: true,
    isDeleted: false,
  }).lean();

  return docs.map(docToTemplate);
};

export const getPromptTemplateByFeedId = async (feedId) => {
  const doc = await PixversePromptTemplate.findOne({
    feedId,
    isApproved: true,
    isPublic: true,
    isDeleted: false,
  }).lean();

  return doc ? docToTemplate(doc) : null;
};

/**
 * Finds a template by feedId OR MongoDB _id, with no approval/public filter.
 * Used at generation time — the user already paid/authenticated, so
 * user-created child templates (isApproved:false, isPublic:false) must
 * also be resolvable.
 */
export const getPromptTemplateForGeneration = async (templateId) => {
  if (!templateId) return null;

  // Try feedId first (string like "trend-xyz" or "created-abc")
  let doc = await PixversePromptTemplate.findOne({
    feedId: templateId,
    isDeleted: false,
  }).lean();

  // Fallback: try MongoDB ObjectId
  if (!doc && mongoose.isValidObjectId(templateId)) {
    doc = await PixversePromptTemplate.findOne({
      _id: templateId,
      isDeleted: false,
    }).lean();
  }

  return doc ? docToTemplate(doc) : null;
};

// ─── Shape DB doc → PIXVERSE_VIDEO_TEMPLATES entry ───────────────────────────
const docToTemplate = (doc) => ({
  // Identity
  id:          doc.feedId,
  name:        doc.title,
  description: doc.description  || '',
  category:    doc.category     || 'prompt',

  // Generation
  prompt:               doc.prompt         || '',
  negative_prompt:      doc.negativePrompt || null,
  duration:             doc.durationSeconds,
  model:                doc.model          || 'v5.6',
  fps:                  doc.fps            || 24,
  quality:              doc.quality        || '720p',
  motion_mode:          doc.motionMode     || 'normal',
  motionType:           doc.motionType     || 'character-animation',
  seed:                 doc.seed           ?? null,

  // Audio
  generate_audio_switch: doc.soundEffectSwitch   ?? false,
  sound_effect_content:  doc.soundEffectContent  || null,

  // UX
  tags:           doc.tags    || [],
  icon:           doc.icon    || null,
  bestFor:        doc.bestFor || null,
  previewVideoUrl: doc.videoUrl || null,

  // Needed at generation time by PixVerseVideoService
  pixverseVideoMediaId: doc.pixverseVideoMediaId || null,
});
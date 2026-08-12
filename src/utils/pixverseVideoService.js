import axios from 'axios';
import { uploadBase64VideoToS3 } from './uploadBase64ToS3.js';
import { PIXVERSE_VIDEO_TEMPLATES, PIXVERSE_TEMPLATE_CATEGORIES } from '../data/pixverseVideoTemplates.js';
import { saveUserAsset } from './SaveAsset.js';
import config from '../config/config.js';
import { uploadToS3 } from '../utils/upload.js';
import { getPromptTemplatesFromDB, getPromptTemplateForGeneration } from './getPromptTemplatesfromDB.js';

class PixVerseVideoService {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://app-api.pixverse.ai/openapi/v2',
      timeout: 300000, // 5 minutes
    });

    this.client.interceptors.request.use((config) => {
      console.log('🎬 PixVerse API Request:', config.method?.toUpperCase(), config.url);
      if (config.data) {
        console.log('📝 Request Data:', JSON.stringify(config.data, null, 2));
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        console.log('✅ PixVerse API Response:', response.status, response.data);
        return response;
      },
      (error) => {
        console.error('❌ PixVerse API Error:', error.response?.status, error.response?.data);
        throw error;
      }
    );
  }

  getTemplates = async (category = null) => {
    const templates = await getPromptTemplatesFromDB();
    if (!category || category === 'all') return templates;
    return templates.filter(template => template.category === category);
  };

  getTemplateById = async (templateId) => {
    const dbTemplate = await getPromptTemplateForGeneration(templateId);
    if (dbTemplate) return dbTemplate;
    return PIXVERSE_VIDEO_TEMPLATES.find((t) => t.id === templateId) || null;
  };

  getCategories = async () => {
    const templates = await getPromptTemplatesFromDB();
    const unique = [...new Set(templates.map((t) => t.category).filter(Boolean))];
    return unique;
  };

  getTTSSpeakers = async (apiKey) => {
    try {
      const response = await this.client.get('/video/lip_sync/tts_list', {
        params: { page_num: 1, page_size: 15 },
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': this.generateTraceId(),
          'Content-Type': 'application/json',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Failed to get TTS speakers: ${response.data.ErrMsg}`);
      }

      return response.data.Resp.data || [];
    } catch (error) {
      console.error('❌ Error getting TTS speakers:', error);
      return [];
    }
  };

  generateLipSync = async (sourceVideoId, speakerId, content, apiKey) => {
    try {
      console.log('🎙️ Starting lip sync generation...');

      const requestData = {
        source_video_id: sourceVideoId,
        lip_sync_tts_speaker_id: speakerId,
        lip_sync_tts_content: content,
      };

      const response = await this.client.post('/video/lip_sync/generate', requestData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': this.generateTraceId(),
          'Content-Type': 'application/json',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Lip sync generation failed: ${response.data.ErrMsg}`);
      }

      console.log('✅ Lip sync generation started, video_id:', response.data.Resp.video_id);
      return response.data.Resp.video_id;
    } catch (error) {
      console.error('❌ Error generating lip sync:', error);
      throw error;
    }
  };

  removeBackground = async (imageBuffer) => {
    try {
      console.log('🎨 Removing background from product image...');

      const rembg = await import('rembg');
      const result = await rembg.default(imageBuffer);

      let cleanImageBuffer;
      if (Buffer.isBuffer(result)) {
        cleanImageBuffer = result;
      } else if (typeof result === 'string') {
        const base64Data = result.replace(/^data:image\/png;base64,/, '');
        cleanImageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        throw new Error('Unexpected result format from rembg');
      }

      console.log('✅ Background removed successfully');
      return cleanImageBuffer;
    } catch (error) {
      console.error('❌ Background removal failed:', error);
      console.log('🔄 Continuing with original image...');
      return imageBuffer;
    }
  };

  generateVideo = async (imageBuffer, template, userInput, apiKey, traceId) => {
    try {
      console.log('🎬 Starting PixVerse video generation...');

      let processedImageBuffer = imageBuffer;
      if (template.id === 'universal-product-ad') {
        console.log('🎨 Processing universal product ad - removing background...');
        processedImageBuffer = await this.removeBackground(imageBuffer);
      }

      const imgId = await this.uploadImage(processedImageBuffer, apiKey);
      console.log('📸 Image uploaded successfully, img_id:', imgId);

      const videoId = await this.generateVideoFromImage({imgId, template, userInput, apiKey, traceId: traceId || this.generateTraceId()});
      console.log('🎥 Video generation started, video_id:', videoId);

      const videoUrl = await this.pollForResult(videoId, apiKey);
      console.log('🎬 Video generation completed, URL:', videoUrl);

      const s3Url = await this.downloadAndUploadToS3(videoUrl, template, userInput);
      console.log('📤 Video uploaded to S3:', s3Url);

      return {
        success: true,
        videoUrl: s3Url,
        originalVideoId: videoId,
        template,
        userInput,
        generationTime: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ PixVerse video generation failed:', error);
      throw error;
    }
  };

  uploadImage = async (imageBuffer, apiKey) => {
    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('image', blob, 'input.jpg');

      const response = await this.client.post('/image/upload', formData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': this.generateTraceId(),
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Image upload failed: ${response.data.ErrMsg}`);
      }

      return response.data.Resp.img_id;
    } catch (error) {
      console.error('❌ Image upload error:', error);
      throw error;
    }
  };

  uploadImageAndSaveAsset = async (imageBuffer, apiKey, userId) => {
    try {
      const fileName = `user-${userId}-${Date.now()}.jpg`;

      const url = await uploadToS3(
        imageBuffer,
        fileName,
        config.AWS_S3_ASSETS_FOLDER || 'user-assets',
        'image/jpeg',
      );

      const asset = await saveUserAsset({
        userId,
        fileBuffer: imageBuffer,
        url,
        key: `${config.AWS_S3_ASSETS_FOLDER}/${fileName}`,
        mimeType: 'image/jpeg',
        originalName: fileName,
        type: 'image',
      });

      const imgId = await this.uploadImage(imageBuffer, apiKey);

      return { imgId, asset };
    } catch (error) {
      console.error('❌ Upload + Save Asset error:', error);
      throw error;
    }
  };

  // Upload a user-provided video to PixVerse (gets back video_media_id)
  uploadVideoMedia = async (videoBuffer, mimeType, apiKey, originalName = 'input.mp4') => {
    try {
      const formData = new FormData();
      const blob = new Blob([videoBuffer], { type: mimeType || 'video/mp4' });
      formData.append('file', blob, originalName);

      const response = await this.client.post('/media/upload', formData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': this.generateTraceId(),
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Video upload failed: ${response.data.ErrMsg}`);
      }

      return response.data.Resp; // { media_id, media_type, url }
    } catch (error) {
      console.error('❌ Video media upload error:', error);
      throw error;
    }
  };

  generateSwapMaskSelection = async ({ sourceVideoId, videoMediaId, keyframeId = 1, traceId }, apiKey) => {
    try {
      const requestData = { keyframe_id: keyframeId };

      if (sourceVideoId != null && videoMediaId != null) {
        throw new Error('Provide either sourceVideoId or videoMediaId, not both.');
      }
      if (sourceVideoId == null && videoMediaId == null) {
        throw new Error('Either sourceVideoId or videoMediaId is required.');
      }

      const normalizedSourceVideoId =
        sourceVideoId != null && /^\d+$/.test(String(sourceVideoId))
          ? Number(sourceVideoId)
          : sourceVideoId;
      const normalizedVideoMediaId =
        videoMediaId != null && /^\d+$/.test(String(videoMediaId))
          ? Number(videoMediaId)
          : videoMediaId;

      if (normalizedSourceVideoId != null) requestData.source_video_id = normalizedSourceVideoId;
      if (normalizedVideoMediaId != null) requestData.video_media_id = normalizedVideoMediaId;

      const response = await this.client.post('/video/mask/selection', requestData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': traceId,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Swap mask selection failed: ${response.data.ErrMsg}`);
      }

      const maskInfo = response.data.Resp.mask_info;
      if (!maskInfo || maskInfo.length === 0) {
        throw new Error('No faces detected in the video');
      }

      const firstMask = maskInfo[0];
      console.log('✅ Face mask extracted:', { mask_id: firstMask.mask_id });

      return {
        mask_id: firstMask.mask_id,
        keyframe_id: response.data.Resp.keyframe_id,
        keyframe_url: response.data.Resp.keyframe_url,
        all_masks: maskInfo,
        traceId
      };
    } catch (error) {
      console.error('❌ Swap mask selection error:', error);
      throw { error, traceId };
    }
  };

  generateSwap = async ({
    sourceVideoId,
    videoMediaId,
    keyframeId,
    maskId,
    imgId,
    quality,
    originalSoundSwitch = true,
    traceId
  }, apiKey) => {
    try {
      const requestData = {
        keyframe_id: keyframeId,
        mask_id: String(maskId),
        img_id: imgId,
        quality,
        original_sound_switch: originalSoundSwitch,
      };

      if (sourceVideoId != null && videoMediaId != null) {
        throw new Error('Provide either sourceVideoId or videoMediaId, not both.');
      }
      if (sourceVideoId == null && videoMediaId == null) {
        throw new Error('Either sourceVideoId or videoMediaId is required.');
      }

      const normalizedSourceVideoId =
        sourceVideoId != null && /^\d+$/.test(String(sourceVideoId))
          ? Number(sourceVideoId)
          : sourceVideoId;
      const normalizedVideoMediaId =
        videoMediaId != null && /^\d+$/.test(String(videoMediaId))
          ? Number(videoMediaId)
          : videoMediaId;

      if (normalizedSourceVideoId != null) requestData.source_video_id = normalizedSourceVideoId;
      if (normalizedVideoMediaId != null) requestData.video_media_id = normalizedVideoMediaId;



      const response = await this.client.post('/video/swap/generate', requestData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': traceId,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Swap generation failed: ${response.data.ErrMsg}`);
      }

      return response.data.Resp; // { video_id, credits }
    } catch (error) {
      console.error('❌ Swap generation error:', error);
      throw error;
    }
  };

  generateVideoFromImage = async ({imgId, template, userInput, apiKey, traceId}) => {
    try {
      const prompt = template.prompt;

      const requestData = {
        img_id: imgId,
        prompt,
        model: template.model || 'v5.6',
        duration: template.duration || 8,
        quality: template.quality || '720p',
        motion_mode: template.motion_mode || 'normal',
        seed: template.seed || Math.floor(Math.random() * 2147483647),
      };

      if (template.camera_movement && template.motionType === 'camera-movement') {
        console.log('📹 Adding camera movement:', template.camera_movement);
        requestData.camera_movement = template.camera_movement;
      } else if (template.camera_movement) {
        console.log('⚠️ Skipping camera_movement for character animation (', template.motionType, ')');
      }

      if (template.lip_sync_switch) {
        requestData.lip_sync_switch = template.lip_sync_switch;
        if (template.lip_sync_tts_content) {
          requestData.lip_sync_tts_content = template.lip_sync_tts_content;
        }
      }

      const v5plusModels = ['v5.5', 'v5.6', 'v6', 'c1'];
      if (v5plusModels.includes(requestData.model)) {
        if (template.generate_audio_switch === true) {
          requestData.generate_audio_switch = true;
        }
      } else {
        if (template.sound_effect_switch) {
          requestData.sound_effect_switch = template.sound_effect_switch;
          if (template.sound_effect_content) {
            requestData.sound_effect_content = template.sound_effect_content;
          }
        }
      }

      if (template.negative_prompt) {
        requestData.negative_prompt = template.negative_prompt;
      }

      console.log('🎬 PixVerse video generation request:', {
        img_id: imgId,
        prompt: prompt.substring(0, 150) + '...',
        model: requestData.model,
        duration: requestData.duration,
        motion_mode: requestData.motion_mode,
        camera_movement: requestData.camera_movement || 'none (character animation)',
        motionType: template.motionType,
      });

      const response = await this.client.post('/video/img/generate', requestData, {
        headers: {
          'API-KEY': apiKey,
          'Ai-trace-id': traceId,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.ErrCode !== 0) {
        throw new Error(`Video generation failed: ${response.data.ErrMsg}`);
      }

      return response.data.Resp.video_id;
    } catch (error) {
      console.error('❌ Video generation error:', error);
      throw { error, traceId };
    }
  };

  pollForResult = async (videoId, apiKey, pollConfig = undefined) => {
    const legacyMaxAttempts = typeof pollConfig === 'number' ? pollConfig : undefined;

    const timeoutMsRaw = typeof pollConfig === 'object' && pollConfig ? pollConfig.timeoutMs : undefined;
    const pollIntervalMsRaw = typeof pollConfig === 'object' && pollConfig ? pollConfig.pollIntervalMs : undefined;
    const maxAttemptsRaw = typeof pollConfig === 'object' && pollConfig ? pollConfig.maxAttempts : undefined;

    const envTimeoutMs = Number(process.env.PIXVERSE_POLL_TIMEOUT_MS);
    const envPollIntervalMs = Number(process.env.PIXVERSE_POLL_INTERVAL_MS);

    const timeoutMs =
      Number.isFinite(Number(timeoutMsRaw)) && Number(timeoutMsRaw) > 0
        ? Number(timeoutMsRaw)
        : Number.isFinite(envTimeoutMs) && envTimeoutMs > 0
          ? envTimeoutMs
          : null;

    const pollIntervalMs = Number.isFinite(Number(pollIntervalMsRaw))
      ? Number(pollIntervalMsRaw)
      : Number.isFinite(envPollIntervalMs) && envPollIntervalMs > 0
        ? envPollIntervalMs
        : 5000;

    const maxAttempts =
      (Number.isFinite(Number(maxAttemptsRaw)) && Number(maxAttemptsRaw) > 0
        ? Number(maxAttemptsRaw)
        : undefined) ??
      (Number.isFinite(Number(legacyMaxAttempts)) && Number(legacyMaxAttempts) > 0
        ? Number(legacyMaxAttempts)
        : undefined) ??
      (timeoutMs ? Math.max(1, Math.ceil(timeoutMs / pollIntervalMs)) : Number.POSITIVE_INFINITY);

    const startedAt = Date.now();
    let attempts = 0;
    let lastStatus = null;

    while (
      attempts < maxAttempts &&
      (timeoutMs == null || Date.now() - startedAt < timeoutMs)
    ) {
      try {
        const response = await this.client.get(`/video/result/${videoId}`, {
          headers: {
            'API-KEY': apiKey,
            'Ai-trace-id': this.generateTraceId(),
          },
        });

        const result = response.data.Resp;
        const status = result?.status;
        lastStatus = status;

        console.log(`📊 Poll attempt ${attempts + 1}, status: ${status}`);

        if (status === 1) {
          if (!result?.url) throw new Error('PixVerse returned success status but no URL');
          return result.url;
        }

        if (status === 5) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        if (status === 7) throw new Error('Video failed content moderation');
        if (status === 8) throw new Error('Video generation failed');

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        console.error(`❌ Poll attempt ${attempts + 1} failed:`, error);
        attempts++;
        if (
          attempts >= maxAttempts ||
          (timeoutMs != null && Date.now() - startedAt >= timeoutMs)
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    const elapsedMs = Date.now() - startedAt;
    throw new Error(
      `Video generation timed out after ${attempts} attempts (${elapsedMs}ms). Last status: ${String(lastStatus)}`
    );
  };

  downloadAndUploadToS3 = async (videoUrl, template, userInput) => {
    try {
      console.log('📥 Downloading video from PixVerse...');

      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      const base64Video = Buffer.from(response.data).toString('base64');

      const timestamp = Date.now();
      const templateName =
        template?.title?.toLowerCase().replace(/\s+/g, '-') ||
        template?.name?.toLowerCase().replace(/\s+/g, '-') ||
        'video';
      const filename = `pixverse-${templateName}-${timestamp}.mp4`;

      const s3Url = await uploadBase64VideoToS3(base64Video, filename, 'video/mp4');

      return s3Url;
    } catch (error) {
      console.error('❌ Download and upload error:', error);
      throw error;
    }
  };

  buildPrompt = (template, userInput) => {
    if (!template || !template.prompt) return '';

    let prompt = template.prompt;

    const safeUserInput = userInput || {};
    const getValue = (key) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return '';
      return safeUserInput[normalizedKey] ?? template[normalizedKey] ?? '';
    };

    prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = getValue(key);
      return value === undefined || value === null ? '' : String(value);
    });

    const mood = (safeUserInput.mood ?? '').toString().trim();
    if (mood) prompt = `${prompt}\n\nMOOD / TREND VIBE: ${mood}.`;

    const style = (safeUserInput.style ?? '').toString().trim();
    if (style && !style.toLowerCase().includes('mood')) {
      prompt = `${prompt}\n\nSTYLE / LOOK: ${style}.`;
    }

    return prompt.trim();
  };

  generateTraceId = () => {
    return `pixverse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  validateApiKey = (apiKey) => {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Valid PixVerse API key is required');
    }
  };
}

export default new PixVerseVideoService();
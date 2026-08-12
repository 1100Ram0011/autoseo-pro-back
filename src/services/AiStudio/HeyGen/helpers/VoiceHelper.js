/**
 * HeyGen Voice Helper Utility
 */

export class VoiceHelper {
  static filterVoices(voices = [], criteria = {}) {
    return voices.filter((voice) => {
      if (criteria.language && voice.language?.toLowerCase() !== criteria.language.toLowerCase()) {
        return false;
      }
      if (criteria.gender && voice.gender?.toLowerCase() !== criteria.gender.toLowerCase()) {
        return false;
      }
      if (criteria.locale && voice.locale?.toLowerCase() !== criteria.locale.toLowerCase()) {
        return false;
      }
      if (criteria.supportPause !== undefined && voice.support_pause !== criteria.supportPause) {
        return false;
      }
      if (criteria.search) {
        const query = criteria.search.toLowerCase();
        const nameMatch = voice.name?.toLowerCase().includes(query);
        const idMatch = voice.voice_id?.toLowerCase().includes(query);
        if (!nameMatch && !idMatch) return false;
      }
      return true;
    });
  }

  static formatSpeechSetting({ speed = 1.0, pitch = 0, volume = 100, emotion = null }) {
    return {
      speed: Math.max(0.5, Math.min(2.0, speed)),
      pitch: Math.max(-10, Math.min(10, pitch)),
      volume: Math.max(0, Math.min(100, volume)),
      ...(emotion ? { emotion } : {}),
    };
  }

  static formatVoiceClonePayloadV3({ name, audioUrl }) {
    return {
      voice_name: name || `Voice_${Date.now()}`,
      audio: {
        type: "url",
        url: audioUrl,
      },
    };
  }

  static formatVoiceClonePayloadV2({ name, audioUrl, gender, language }) {
    return {
      name: name || `Voice_${Date.now()}`,
      audio_url: audioUrl,
      ...(gender ? { gender } : {}),
      ...(language ? { language } : {}),
    };
  }
}

export default VoiceHelper;

/**
 * HeyGen Multi-Scene Video Helper Utility
 */

export class SceneHelper {
  static createScene({ avatarId, voiceId, text, background = null, elements = [] }) {
    return {
      character: {
        type: "avatar",
        avatar_id: avatarId,
        avatar_style: "normal",
      },
      voice: {
        type: "text",
        voice_id: voiceId,
        input_text: text,
      },
      ...(background ? { background } : {}),
      ...(elements.length > 0 ? { elements } : {}),
    };
  }

  static composeMultiSceneScript(scenes = []) {
    return scenes.map((scene, index) => ({
      scene_id: `scene_${index + 1}`,
      ...scene,
    }));
  }
}

export default SceneHelper;

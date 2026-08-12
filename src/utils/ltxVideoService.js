// LTX - All service functionality commented out, use PixVerse only
import axios from 'axios';
// import { VIDEO_TEMPLATES, buildPromptFromTemplate } from '../data/videoTemplates.js';  // LTX - Commented out
import { uploadBase64VideoToS3 } from './uploadBase64ToS3.js';
import { v4 as uuidv4 } from 'uuid';

class LTXVideoService {
  constructor() {
    // LTX - All API functionality disabled
    // this.apiKey = process.env.LTXV_API_KEY;
    // this.baseURL = 'https://api.ltx.video/v1';
    // this.client = axios.create({
    //   baseURL: this.baseURL,
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json'
    //   }
    // });
  }

  /**
   * Upload image to LTX storage - DISABLED
   */
  async uploadImage(fileBuffer, mimeType) {
    // LTX - Disabled, use PixVerse instead
    throw new Error('LTX video service is disabled. Please use PixVerse instead.');
  }

  /**
   * Generate video from template - DISABLED
   */
  async generateVideoFromTemplate(imageUrl, templateId, userInput, options = {}) {
    // LTX - Disabled, use PixVerse instead
    throw new Error('LTX video service is disabled. Please use PixVerse instead.');
  }

  /**
   * Get video generation status - DISABLED
   */
  async getVideoStatus(taskId) {
    // LTX - Disabled, use PixVerse instead
    throw new Error('LTX video service is disabled. Please use PixVerse instead.');
  }

  /**
   * Get available templates - DISABLED
   */
  getTemplates(category = null) {
    // LTX - Disabled, use PixVerse instead
    return [];
  }

  /**
   * Get template by ID - DISABLED
   */
  getTemplateById(templateId) {
    // LTX - Disabled, use PixVerse instead
    return null;
  }

  /**
   * Validate template input - DISABLED
   */
  validateTemplateInput(templateId, userInput) {
    // LTX - Disabled, use PixVerse instead
    return { valid: false, errors: ['LTX service is disabled'] };
  }
}

      const taskId = responseData.task_id || responseData.id || responseData.taskId;
      const videoUri = responseData.video_uri || responseData.videoUrl || responseData.output_url;
      
      if (!taskId && !videoUri) {
        console.error('No task ID or video URI found in LTX response:', responseData);
        throw new Error('No task ID or video URI returned from LTX API');
      }
      
      return {
        success: true,
        videoUri: videoUri,
        taskId: taskId,
        template: template,
        prompt: prompt,
        status: taskId ? 'processing' : 'completed',
        fullResponse: responseData
      };

    } catch (error) {
      console.error('Error generating video with LTX:', error);
      
      if (error.response) {
        const errorData = error.response.data;
        console.error('LTX API Error Response:', errorData);
        
        // Parse the error response (it's a Buffer due to responseType: 'arraybuffer')
        let parsedError;
        try {
          if (Buffer.isBuffer(errorData)) {
            const errorText = errorData.toString('utf-8');
            parsedError = JSON.parse(errorText);
          } else {
            parsedError = errorData;
          }
          console.error('Parsed LTX Error:', parsedError);
        } catch (parseError) {
          console.error('Failed to parse LTX error response:', parseError);
        }
        
        // Extract the actual error message
        let errorMessage = 'LTX API Error: 400';
        if (parsedError && parsedError.error && parsedError.error.message) {
          errorMessage = parsedError.error.message;
        } else if (parsedError && parsedError.message) {
          errorMessage = parsedError.message;
        } else if (parsedError && parsedError.error) {
          errorMessage = JSON.stringify(parsedError.error);
        }
        
        throw new Error(errorMessage);
      }
      
      throw new Error('Failed to generate video with LTX');
    }
  }

  /**
   * Get video generation status
   */
  async getVideoStatus(taskId) {
    try {
      if (!taskId) {
        throw new Error('Task ID is required');
      }
      
      console.log('Checking status for task:', taskId);
      // ✅ Default to JSON response (no responseType override needed)
      const response = await this.client.get(`/tasks/${taskId}`);
      console.log('Status response:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error getting video status:', error);
      if (error.response && error.response.status === 404) {
        console.log('Task not found, might still be processing...');
        return { status: 'processing', message: 'Task not yet available' };
      }
      throw new Error('Failed to get video generation status');
    }
  }

  /**
   * Get available templates
   */
  getTemplates(category = null) {
    if (category && category !== 'all') {
      return VIDEO_TEMPLATES.filter(t => t.category === category);
    }
    return VIDEO_TEMPLATES;
  }

  /**
   * Get template by ID
   */
  getTemplateById(templateId) {
    return VIDEO_TEMPLATES.find(t => t.id === templateId);
  }

  /**
   * Validate template input
   */
  validateTemplateInput(templateId, userInput) {
    const template = this.getTemplateById(templateId);
    if (!template) {
      return { valid: false, error: 'Template not found' };
    }

    const errors = [];
    
    // Check for required variables in template prompt
    const requiredVars = template.prompt.match(/\{\{(\w+)\}\}/g);
    if (requiredVars) {
      requiredVars.forEach(varMatch => {
        const varName = varMatch.replace(/[{}]/g, '');
        if (!userInput[varName] || userInput[varName].trim() === '') {
          errors.push(`${varName} is required for this template`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
}

export default new LTXVideoService();
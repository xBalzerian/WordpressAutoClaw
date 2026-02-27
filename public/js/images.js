/**
 * Image Generation Service
 * Uses Laozhang AI API
 */

class ImageService {
  constructor(config) {
    this.apiKey = config.LAOZHANG_API_KEY;
    this.baseUrl = config.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
    this.model = config.LAOZHANG_MODEL || 'gemini-3-pro-image-preview';
    
    // GitHub config for hosting
    this.githubToken = config.GITHUB_TOKEN;
    this.githubRepo = config.GITHUB_REPO;
    this.githubBranch = config.GITHUB_BRANCH || 'main';
    this.githubPath = config.GITHUB_IMAGE_PATH || 'images';
  }

  /**
   * Generate featured image for an article
   */
  async generateImage(prompt, options = {}) {
    try {
      console.log('Generating image with prompt:', prompt);
      
      // Call backend API
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate image');
      }
      
      const data = await response.json();
      
      // Convert base64 to data URL
      const imageUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
      
      return {
        success: true,
        imageUrl: imageUrl,
        imageBase64: data.imageBase64,
        prompt: prompt
      };
    } catch (error) {
      console.error('Image generation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Enhance image prompt for better results
   */
  enhancePrompt(basePrompt, articleTitle) {
    let enhanced = basePrompt || `Featured image for article: ${articleTitle}`;
    
    // Add quality modifiers
    const modifiers = [
      'high quality',
      'professional',
      'detailed',
      'sharp focus',
      'suitable for blog featured image',
      'wide format composition',
      'professional lighting'
    ];
    
    modifiers.forEach(mod => {
      if (!enhanced.toLowerCase().includes(mod)) {
        enhanced += `, ${mod}`;
      }
    });
    
    return enhanced;
  }

  /**
   * Upload image to GitHub for hosting
   */
  async uploadToGitHub(imageBase64, filename) {
    try {
      const timestamp = Date.now();
      const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-');
      
      // Call backend API
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          imageBase64,
          filename: `${timestamp}-${safeFilename}`
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload image');
      }
      
      return await response.json();
    } catch (error) {
      console.error('GitHub upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Convert ArrayBuffer to base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageService;
}

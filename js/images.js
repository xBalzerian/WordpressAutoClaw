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
    const { width = 1200, height = 630 } = options;
    
    try {
      console.log('Generating image with prompt:', prompt);
      
      // For testing without actual API call
      await this.simulateDelay(3000);
      
      // In production, this would call Laozhang API
      // const response = await fetch(`${this.baseUrl}/images/generations`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${this.apiKey}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify({
      //     model: this.model,
      //     prompt: prompt,
      //     n: 1,
      //     size: `${width}x${height}`,
      //     quality: 'high'
      //   })
      // });
      
      // Mock response
      return {
        success: true,
        imageUrl: 'https://via.placeholder.com/1200x630/E53935/FFFFFF?text=Generated+Image',
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
  async uploadToGitHub(imageBuffer, filename) {
    try {
      const timestamp = Date.now();
      const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-');
      const filePath = `${this.githubPath}/${timestamp}-${safeFilename}`;
      
      // Convert to base64
      const base64Content = typeof imageBuffer === 'string' 
        ? imageBuffer 
        : this.arrayBufferToBase64(imageBuffer);
      
      const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Upload image: ${safeFilename}`,
          content: base64Content,
          branch: this.githubBranch
        })
      });
      
      if (!response.ok) {
        throw new Error(`GitHub upload failed: ${response.status}`);
      }
      
      const data = await response.json();
      return {
        success: true,
        url: data.content.download_url,
        htmlUrl: data.content.html_url,
        sha: data.content.sha,
        path: filePath
      };
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

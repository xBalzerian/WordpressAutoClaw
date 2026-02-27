// WordPress Auto Claw - Configuration
// Copy this file to config.js and fill in your values

const CONFIG = {
  // ==========================================
  // GOOGLE SHEETS
  // ==========================================
  // Your Google Sheet URL (must be shared with "Anyone with the link can edit")
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1B9hYh1EWi0oJe19DFFuNhJNRUNe-26Pdk9CX9RpnX9A/edit?usp=sharing',
  
  // ==========================================
  // LAOZHANG AI - Image Generation
  // ==========================================
  LAOZHANG_API_KEY: 'your-laozhang-api-key-here',
  LAOZHANG_BASE_URL: 'https://api.laozhang.ai/v1',
  LAOZHANG_MODEL: 'gemini-3-pro-image-preview',
  
  // ==========================================
  // GITHUB - Image Hosting
  // ==========================================
  GITHUB_TOKEN: 'your-github-token-here',
  GITHUB_REPO: 'yourusername/images-repo', // Images will be stored here
  GITHUB_BRANCH: 'main',
  GITHUB_IMAGE_PATH: 'images',
  
  // ==========================================
  // WORDPRESS - Publishing (Fill in later)
  // ==========================================
  WP_URL: '', // e.g., https://yoursite.com
  WP_USERNAME: '',
  WP_APP_PASSWORD: '', // Application password, not your regular password
  
  // ==========================================
  // CONTENT GENERATION SETTINGS
  // ==========================================
  CONTENT: {
    wordCount: 1500,
    tone: 'professional', // professional, casual, friendly, formal, witty
    includeFAQ: true,
    includeCTA: true
  }
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

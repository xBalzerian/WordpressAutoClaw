// Client-side config - loads from backend
// This file is a placeholder - actual config comes from environment variables on the server

const CONFIG = {
  // These will be set by the backend API
  SHEET_URL: '',
  LAOZHANG_API_KEY: '',
  LAOZHANG_BASE_URL: 'https://api.laozhang.ai/v1',
  LAOZHANG_MODEL: 'gemini-3-pro-image-preview',
  GITHUB_TOKEN: '',
  GITHUB_REPO: '',
  GITHUB_BRANCH: 'main',
  WP_URL: '',
  WP_USERNAME: '',
  WP_APP_PASSWORD: '',
  
  CONTENT: {
    wordCount: 1500,
    tone: 'professional',
    includeFAQ: true,
    includeCTA: true
  }
};

// Load config from backend on startup
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const serverConfig = await response.json();
      Object.assign(CONFIG, serverConfig);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, loadConfig };
}

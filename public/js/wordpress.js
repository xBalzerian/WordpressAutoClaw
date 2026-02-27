/**
 * WordPress Publishing Service
 * Publishes articles to WordPress via backend API
 */

class WordPressService {
  constructor(config) {
    this.wpUrl = config.WP_URL?.replace(/\/+$/, '');
    this.username = config.WP_USERNAME;
    this.password = config.WP_APP_PASSWORD;
  }

  /**
   * Check if WordPress is configured
   */
  isConfigured() {
    return !!(this.wpUrl && this.username && this.password);
  }

  /**
   * Test WordPress connection
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'WordPress not configured'
      };
    }

    try {
      const response = await fetch('/api/health');
      if (response.ok) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Backend not responding'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Publish article to WordPress via backend API
   */
  async publishArticle(article) {
    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: article.title,
          content: article.content,
          excerpt: article.excerpt,
          tags: article.tags,
          featuredImageUrl: article.featuredImageUrl
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to publish');
      }

      return await response.json();
    } catch (error) {
      console.error('Publish error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WordPressService;
}

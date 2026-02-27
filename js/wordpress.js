/**
 * WordPress Publishing Service
 * Publishes articles to WordPress via REST API
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
        error: 'WordPress not configured. Please add WP_URL, WP_USERNAME, and WP_APP_PASSWORD to config.js'
      };
    }

    try {
      const response = await fetch(`${this.wpUrl}/wp-json/wp/v2/users`, {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        return { success: true };
      } else {
        const error = await response.json();
        return {
          success: false,
          error: error.message || `HTTP ${response.status}`
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
   * Publish article to WordPress
   */
  async publishArticle(article) {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'WordPress not configured'
      };
    }

    try {
      const postData = {
        title: article.title,
        content: article.content,
        excerpt: article.excerpt || '',
        status: 'publish',
        format: 'standard'
      };

      // Add tags if provided
      if (article.tags) {
        const tagNames = article.tags.split(',').map(t => t.trim()).filter(t => t);
        if (tagNames.length > 0) {
          // Create tags and get IDs
          const tagIds = await Promise.all(
            tagNames.map(name => this.getOrCreateTag(name))
          );
          postData.tags = tagIds.filter(id => id);
        }
      }

      // Add featured image if provided
      if (article.featuredImageUrl) {
        const mediaId = await this.uploadFeaturedImage(article.featuredImageUrl);
        if (mediaId) {
          postData.featured_media = mediaId;
        }
      }

      const response = await fetch(`${this.wpUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        postId: data.id,
        url: data.link,
        title: data.title.rendered
      };
    } catch (error) {
      console.error('Publish error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get or create a tag
   */
  async getOrCreateTag(tagName) {
    try {
      // Search for existing tag
      const searchResponse = await fetch(
        `${this.wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(tagName)}&per_page=1`,
        {
          headers: {
            'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`)
          }
        }
      );

      if (searchResponse.ok) {
        const tags = await searchResponse.json();
        if (tags.length > 0) {
          return tags[0].id;
        }
      }

      // Create new tag
      const createResponse = await fetch(`${this.wpUrl}/wp-json/wp/v2/tags`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: tagName })
      });

      if (createResponse.ok) {
        const tag = await createResponse.json();
        return tag.id;
      }

      return null;
    } catch (error) {
      console.error('Tag error:', error);
      return null;
    }
  }

  /**
   * Upload featured image from URL
   */
  async uploadFeaturedImage(imageUrl) {
    try {
      // Download image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error('Failed to download image');
      
      const imageBlob = await imageResponse.blob();
      
      // Create form data
      const formData = new FormData();
      formData.append('file', imageBlob, 'featured-image.jpg');

      // Upload to WordPress
      const uploadResponse = await fetch(`${this.wpUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`)
        },
        body: formData
      });

      if (uploadResponse.ok) {
        const media = await uploadResponse.json();
        return media.id;
      }

      return null;
    } catch (error) {
      console.error('Image upload error:', error);
      return null;
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WordPressService;
}

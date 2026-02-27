/**
 * Content Generation Service
 * Uses Kimi API via backend proxy
 */

class ContentService {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate article content using Kimi
   */
  async generateContent(topic, options = {}) {
    const {
      wordCount = 1500,
      tone = 'professional',
      includeFAQ = true,
      includeCTA = true
    } = options;

    const systemPrompt = this.buildSystemPrompt(tone, wordCount);
    const userPrompt = this.buildUserPrompt(topic, { includeFAQ, includeCTA });

    try {
      // For now, we'll use a mock response since we need backend proxy
      // In production, this would call the Kimi API
      console.log('Generating content for:', topic);
      
      // Mock response for testing
      await this.simulateDelay(2000);
      
      return {
        success: true,
        title: `${topic}: A Comprehensive Guide`,
        content: this.generateMockContent(topic, wordCount),
        excerpt: `Learn everything about ${topic} in this comprehensive guide.`,
        tags: topic.toLowerCase().replace(/\s+/g, ', '),
        focusKeyword: topic.toLowerCase()
      };
    } catch (error) {
      console.error('Content generation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  buildSystemPrompt(tone, wordCount) {
    const toneGuidelines = {
      professional: 'Use professional, authoritative language suitable for B2B audiences.',
      casual: 'Use conversational, approachable language. Write like you\'re talking to a friend.',
      friendly: 'Be warm and engaging while maintaining expertise.',
      formal: 'Use formal academic or business writing style.',
      witty: 'Incorporate clever wordplay and humor while remaining informative.'
    };

    return `You are an expert SEO content writer.

GUIDELINES:
- Target length: ${wordCount} words
- Tone: ${toneGuidelines[tone] || toneGuidelines.professional}
- Write for humans first, search engines second
- Use clear headings (H2, H3) with keywords
- Include actionable insights
- Use bullet points where appropriate
- Include compelling introduction and CTA

OUTPUT FORMAT:
TITLE: [SEO-optimized title]
META_DESCRIPTION: [Compelling meta description]
EXCERPT: [2-3 sentence summary]
TAGS: [comma, separated, tags]
FOCUS_KEYWORD: [main keyword]

CONTENT:
[Full article in Markdown]`;
  }

  buildUserPrompt(topic, options) {
    let prompt = `Write a comprehensive, SEO-optimized article about: "${topic}"`;
    
    if (options.includeFAQ) {
      prompt += '\n\nInclude an FAQ section with 3-5 common questions.';
    }
    
    if (options.includeCTA) {
      prompt += '\n\nEnd with a strong call-to-action.';
    }
    
    return prompt;
  }

  generateMockContent(topic, wordCount) {
    // Generate placeholder content for testing
    const paragraphs = Math.ceil(wordCount / 100);
    let content = `# ${topic}: A Comprehensive Guide\n\n`;
    content += `## Introduction\n\n`;
    content += `This is a comprehensive guide about ${topic}. `;
    content += `In this article, we'll explore everything you need to know.\n\n`;
    
    for (let i = 1; i <= paragraphs; i++) {
      content += `## Section ${i}: Key Insights\n\n`;
      content += `Lorem ipsum dolor sit amet, consectetur adipiscing elit. `;
      content += `Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. `;
      content += `Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n\n`;
    }
    
    content += `## Conclusion\n\n`;
    content += `In conclusion, ${topic} is an important topic that deserves attention. `;
    content += `We hope this guide has been helpful.\n\n`;
    content += `## FAQ\n\n`;
    content += `**Q: What is ${topic}?**\n`;
    content += `A: ${topic} refers to...\n\n`;
    content += `**Q: Why is ${topic} important?**\n`;
    content += `A: Understanding ${topic} helps you...\n\n`;
    
    return content;
  }

  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse generated content into structured format
   */
  parseContent(rawContent) {
    const result = {
      title: '',
      metaDescription: '',
      excerpt: '',
      tags: '',
      focusKeyword: '',
      content: rawContent
    };

    // Extract sections
    const titleMatch = rawContent.match(/TITLE:\s*(.+?)(?=\n\n|\n[A-Z_]+:|$)/s);
    if (titleMatch) result.title = titleMatch[1].trim();

    const metaMatch = rawContent.match(/META_DESCRIPTION:\s*(.+?)(?=\n\n|\n[A-Z_]+:|$)/s);
    if (metaMatch) result.metaDescription = metaMatch[1].trim();

    const excerptMatch = rawContent.match(/EXCERPT:\s*(.+?)(?=\n\n|\n[A-Z_]+:|$)/s);
    if (excerptMatch) result.excerpt = excerptMatch[1].trim();

    const tagsMatch = rawContent.match(/TAGS:\s*(.+?)(?=\n\n|\n[A-Z_]+:|$)/s);
    if (tagsMatch) result.tags = tagsMatch[1].trim();

    const keywordMatch = rawContent.match(/FOCUS_KEYWORD:\s*(.+?)(?=\n\n|\n[A-Z_]+:|$)/s);
    if (keywordMatch) result.focusKeyword = keywordMatch[1].trim();

    // Extract main content
    const contentMatch = rawContent.match(/CONTENT:\s*([\s\S]+)$/);
    if (contentMatch) result.content = contentMatch[1].trim();

    return result;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentService;
}

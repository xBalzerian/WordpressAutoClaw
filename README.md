# WordPress Auto Claw - Simple Dashboard

AI-powered content automation for WordPress. Read topics from Google Sheets, generate content with Kimi, create images with Laozhang AI, and publish to WordPress.

## Flow

```
Google Sheets → AI Content → AI Images → WordPress
```

## Setup

1. **Clone this repo**
2. **Copy config file:**
   ```bash
   cp config.template.js config.js
   ```
3. **Fill in your API keys in `config.js`**
4. **Open `index.html` in browser** or deploy to Render

## Configuration

Edit `config.js`:

```javascript
const CONFIG = {
  // Google Sheet (shared with "Anyone with the link can edit")
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit?usp=sharing',
  
  // Laozhang AI (Image Generation)
  LAOZHANG_API_KEY: 'sk-...',
  LAOZHANG_MODEL: 'gemini-3-pro-image-preview',
  
  // GitHub (Image Hosting)
  GITHUB_TOKEN: 'github_pat_...',
  GITHUB_REPO: 'yourusername/images-repo',
  
  // WordPress (Publishing)
  WP_URL: 'https://yoursite.com',
  WP_USERNAME: 'your_username',
  WP_APP_PASSWORD: 'xxxx xxxx xxxx xxxx xxxx'
};
```

## Spreadsheet Format

| Topic | Status | Content | Image_URL | WP_URL | Notes |
|-------|--------|---------|-----------|--------|-------|
| Coffee Tips | PENDING | | | | |
| SEO Guide | CONTENT_DONE | [article...] | | | Ready for image |
| Marketing | IMAGE_DONE | [article...] | https://... | | Ready to publish |
| Tech Review | PUBLISHED | [article...] | https://... | https://... | Done |

## Status Values

- `PENDING` - Topic only, needs content
- `CONTENT_DONE` - Content generated, needs image
- `IMAGE_DONE` - Image ready, needs publish
- `PUBLISHED` - Fully published
- `ERROR` - Something failed

## Deploy to Render

1. Push to GitHub
2. Connect Render to your repo
3. Set environment variables (same as config.js)
4. Deploy

## License

Private - For personal use only.

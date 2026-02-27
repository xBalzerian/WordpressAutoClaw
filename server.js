const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Environment variables
const CONFIG = {
  SHEET_URL: process.env.SHEET_URL,
  LAOZHANG_API_KEY: process.env.LAOZHANG_API_KEY,
  LAOZHANG_BASE_URL: process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1',
  LAOZHANG_MODEL: process.env.LAOZHANG_MODEL || 'gemini-3-pro-image-preview',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO: process.env.GITHUB_REPO,
  GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
  WP_URL: process.env.WP_URL,
  WP_USERNAME: process.env.WP_USERNAME,
  WP_APP_PASSWORD: process.env.WP_APP_PASSWORD
};

// Extract spreadsheet ID from URL
function extractSpreadsheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Parse CSV
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length === 0) return { headers: [], data: [] };

  const parseLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row = { _rowIndex: i + 1 };
    headers.forEach((header, index) => {
      const key = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
      row[key] = values[index] || '';
    });
    data.push(row);
  }

  return { headers, data };
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get sheet data - using Google Sheets API via gviz
app.get('/api/sheet', async (req, res) => {
  try {
    const spreadsheetId = extractSpreadsheetId(CONFIG.SHEET_URL);
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Invalid sheet URL' });
    }

    // Try the new Google Sheets CSV export format
    // First, try the export format
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
    
    console.log('Fetching sheet:', exportUrl);
    
    const response = await axios.get(exportUrl, { 
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });
    
    const parsed = parseCSV(response.data);
    console.log(`Parsed ${parsed.data.length} rows from sheet`);
    res.json(parsed);
  } catch (error) {
    console.error('Sheet error:', error.message);
    console.error('Sheet URL attempted:', CONFIG.SHEET_URL);
    
    // Return more detailed error
    res.status(500).json({ 
      error: 'Failed to fetch sheet',
      details: error.message,
      hint: 'Make sure the sheet is shared with "Anyone with the link can view"'
    });
  }
});

// Generate content (proxy to Kimi)
app.post('/api/generate-content', async (req, res) => {
  try {
    const { topic, wordCount = 1500, tone = 'professional' } = req.body;
    
    // For now, return mock content since we need Kimi API key
    // In production, this would call Kimi API
    const content = `# ${topic}: A Comprehensive Guide

## Introduction

This is a comprehensive guide about ${topic}.

## Key Points

- Point 1 about ${topic}
- Point 2 about ${topic}
- Point 3 about ${topic}

## Conclusion

In conclusion, ${topic} is important.

## FAQ

**Q: What is ${topic}?**
A: ${topic} refers to...

**Q: Why is it important?**
A: Understanding ${topic} helps...`;

    res.json({
      success: true,
      title: `${topic}: A Comprehensive Guide`,
      content,
      excerpt: `Learn everything about ${topic} in this guide.`,
      tags: topic.toLowerCase().replace(/\s+/g, ', ')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate image (proxy to Laozhang)
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    const response = await axios.post(
      `${CONFIG.LAOZHANG_BASE_URL}/images/generations`,
      {
        model: CONFIG.LAOZHANG_MODEL,
        prompt: prompt,
        n: 1,
        size: '1200x630',
        quality: 'high'
      },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.LAOZHANG_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000,
        responseType: 'arraybuffer'
      }
    );

    // Convert to base64
    const base64 = Buffer.from(response.data).toString('base64');
    
    res.json({
      success: true,
      imageBase64: base64,
      mimeType: 'image/png'
    });
  } catch (error) {
    console.error('Image error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Upload image to GitHub
app.post('/api/upload-image', async (req, res) => {
  try {
    const { imageBase64, filename } = req.body;
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-');
    const filePath = `images/${timestamp}-${safeFilename}`;

    const response = await axios.put(
      `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${filePath}`,
      {
        message: `Upload image: ${safeFilename}`,
        content: imageBase64,
        branch: CONFIG.GITHUB_BRANCH
      },
      {
        headers: {
          'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    res.json({
      success: true,
      url: response.data.content.download_url,
      htmlUrl: response.data.content.html_url
    });
  } catch (error) {
    console.error('GitHub error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Publish to WordPress
app.post('/api/publish', async (req, res) => {
  try {
    const { title, content, excerpt, tags, featuredImageUrl } = req.body;

    const postData = {
      title,
      content,
      excerpt: excerpt || '',
      status: 'publish'
    };

    const response = await axios.post(
      `${CONFIG.WP_URL}/wp-json/wp/v2/posts`,
      postData,
      {
        auth: {
          username: CONFIG.WP_USERNAME,
          password: CONFIG.WP_APP_PASSWORD
        }
      }
    );

    res.json({
      success: true,
      postId: response.data.id,
      url: response.data.link
    });
  } catch (error) {
    console.error('WP error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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

// In-memory storage for multiple sheets (will reset on server restart)
let savedSheets = [];

// Extract spreadsheet ID from URL
function extractSpreadsheetId(url) {
  // Handle different URL formats:
  // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
  // https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml
  
  // Try standard format first
  let match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  
  // Try pubhtml format - extract the encoded ID
  match = url.match(/\/d\/e\/([a-zA-Z0-9-_]+)\/pubhtml/);
  if (match) {
    // For pubhtml format, we need to use a different approach
    return `e/${match[1]}`;
  }
  
  return null;
}

// Get sheet name from URL for display
function getSheetNameFromUrl(url) {
  // Extract a readable name from the URL or return default
  return 'Spreadsheet';
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

// Get current sheet URL
app.get('/api/sheet-url', (req, res) => {
  res.json({ 
    url: CONFIG.SHEET_URL,
    name: getSheetNameFromUrl(CONFIG.SHEET_URL)
  });
});

// Update sheet URL (for switching sheets)
app.post('/api/sheet-url', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  CONFIG.SHEET_URL = url;
  res.json({ 
    success: true, 
    url,
    name: getSheetNameFromUrl(url)
  });
});

// Get saved sheets list
app.get('/api/sheets', (req, res) => {
  res.json(savedSheets);
});

// Add a new sheet to the list
app.post('/api/sheets', (req, res) => {
  const { url, name } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const sheet = {
    id: Date.now().toString(),
    url,
    name: name || getSheetNameFromUrl(url),
    addedAt: new Date().toISOString()
  };
  
  savedSheets.push(sheet);
  res.json({ success: true, sheet });
});

// Delete a sheet from the list
app.delete('/api/sheets/:id', (req, res) => {
  const { id } = req.params;
  savedSheets = savedSheets.filter(s => s.id !== id);
  res.json({ success: true });
});

// Switch to a saved sheet
app.post('/api/sheets/:id/switch', (req, res) => {
  const { id } = req.params;
  const sheet = savedSheets.find(s => s.id === id);
  
  if (!sheet) {
    return res.status(404).json({ error: 'Sheet not found' });
  }
  
  CONFIG.SHEET_URL = sheet.url;
  res.json({ success: true, sheet });
});

// Get sheet data
app.get('/api/sheet', async (req, res) => {
  try {
    if (!CONFIG.SHEET_URL) {
      return res.status(400).json({ 
        error: 'No sheet URL configured',
        hint: 'Add a sheet URL in settings'
      });
    }

    const spreadsheetId = extractSpreadsheetId(CONFIG.SHEET_URL);
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Invalid sheet URL format' });
    }

    let exportUrl;
    
    // Check if it's a published document ID (starts with e/)
    if (spreadsheetId.startsWith('e/')) {
      // Use pub format for published sheets
      exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv`;
    } else {
      // Use standard export format
      exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
    }
    
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
    
    res.status(500).json({ 
      error: 'Failed to fetch sheet',
      details: error.message,
      hint: 'Make sure the sheet is published to web (File > Share > Publish to web)'
    });
  }
});

// Generate content
app.post('/api/generate-content', async (req, res) => {
  try {
    const { topic, wordCount = 1500, tone = 'professional' } = req.body;
    
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

// Generate image
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

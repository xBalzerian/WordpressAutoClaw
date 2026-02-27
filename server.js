const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Config from env vars with fallbacks
const CONFIG = {
  SHEET_URL: process.env.SHEET_URL || '',
  LAOZHANG_API_KEY: process.env.LAOZHANG_API_KEY || '',
  LAOZHANG_BASE_URL: process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1',
  LAOZHANG_MODEL: process.env.LAOZHANG_MODEL || 'gemini-3-pro-image-preview',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_REPO: process.env.GITHUB_REPO || '',
  GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main'
};

// Extract spreadsheet ID
function extractSpreadsheetId(url) {
  if (!url) return null;
  let match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  match = url.match(/\/d\/e\/([a-zA-Z0-9-_]+)\/pubhtml/);
  if (match) return `e/${match[1]}`;
  return null;
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

// Get sheet data
app.get('/api/sheet', async (req, res) => {
  try {
    if (!CONFIG.SHEET_URL) {
      return res.status(400).json({ error: 'No sheet URL configured. Add SHEET_URL environment variable.' });
    }
    
    const spreadsheetId = extractSpreadsheetId(CONFIG.SHEET_URL);
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Invalid sheet URL format' });
    }

    const exportUrl = spreadsheetId.startsWith('e/') 
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv`
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;

    console.log('Fetching:', exportUrl);
    const response = await axios.get(exportUrl, { timeout: 10000 });
    const parsed = parseCSV(response.data);
    
    console.log(`Loaded ${parsed.data.length} rows`);
    res.json(parsed);
  } catch (error) {
    console.error('Sheet error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Generate content
app.post('/api/generate-content', async (req, res) => {
  const { topic } = req.body;
  res.json({
    success: true,
    title: `${topic}: A Comprehensive Guide`,
    content: `# ${topic}: A Comprehensive Guide\n\n## Introduction\n\nThis guide covers everything about ${topic}.\n\n## Key Points\n\n- Important point 1\n- Important point 2\n- Important point 3\n\n## Conclusion\n\nIn conclusion, ${topic} is essential.`,
    excerpt: `Learn everything about ${topic} in this comprehensive guide.`,
    tags: topic.toLowerCase().replace(/\s+/g, ', ')
  });
});

// Generate image
app.post('/api/generate-image', async (req, res) => {
  try {
    if (!CONFIG.LAOZHANG_API_KEY) {
      return res.status(400).json({ error: 'Laozhang API key not configured' });
    }
    
    const { prompt } = req.body;
    console.log('Generating image:', prompt);
    
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
    res.json({ success: true, imageBase64: base64, mimeType: 'image/png' });
  } catch (error) {
    console.error('Image error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Upload to GitHub
app.post('/api/upload-image', async (req, res) => {
  try {
    if (!CONFIG.GITHUB_TOKEN || !CONFIG.GITHUB_REPO) {
      return res.status(400).json({ error: 'GitHub not configured' });
    }
    
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

    res.json({ success: true, url: response.data.content.download_url });
  } catch (error) {
    console.error('GitHub error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    sheetConfigured: !!CONFIG.SHEET_URL,
    laozhangConfigured: !!CONFIG.LAOZHANG_API_KEY,
    githubConfigured: !!(CONFIG.GITHUB_TOKEN && CONFIG.GITHUB_REPO)
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Sheet URL:', CONFIG.SHEET_URL ? 'Configured' : 'NOT CONFIGURED');
  console.log('Laozhang API:', CONFIG.LAOZHANG_API_KEY ? 'Configured' : 'NOT CONFIGURED');
  console.log('GitHub:', CONFIG.GITHUB_TOKEN ? 'Configured' : 'NOT CONFIGURED');
});

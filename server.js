const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware (required for OAuth)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load Google credentials from env vars or file
function loadGoogleCredentials() {
  // First try environment variables
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: ['https://wordpress-claw.onrender.com/auth/google/callback']
    };
  }
  
  // Fallback to file
  try {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (fs.existsSync(credentialsPath)) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      return credentials.web;
    }
  } catch (error) {
    console.error('Error loading Google credentials:', error.message);
  }
  
  return null;
}

// Initialize OAuth client
let oauth2Client;
const googleCredentials = loadGoogleCredentials();

if (googleCredentials) {
  oauth2Client = new google.auth.OAuth2(
    googleCredentials.client_id,
    googleCredentials.client_secret,
    googleCredentials.redirect_uris[0]
  );
  console.log('Google OAuth2 client initialized');
} else {
  console.log('Google credentials not found - OAuth will not work');
}

// Load config from file or env vars
function loadConfig() {
  let fileConfig = {};
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading config.json:', error.message);
  }

  return {
    SHEET_URL: process.env.SHEET_URL || fileConfig.SHEET_URL || '',
    LAOZHANG_API_KEY: process.env.LAOZHANG_API_KEY || fileConfig.LAOZHANG_API_KEY || '',
    LAOZHANG_BASE_URL: process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1',
    LAOZHANG_MODEL: process.env.LAOZHANG_MODEL || 'gemini-3-pro-image-preview',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || fileConfig.GITHUB_TOKEN || '',
    GITHUB_REPO: process.env.GITHUB_REPO || fileConfig.GITHUB_REPO || '',
    GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
    WP_URL: process.env.WP_URL || '',
    WP_USERNAME: process.env.WP_USERNAME || '',
    WP_APP_PASSWORD: process.env.WP_APP_PASSWORD || ''
  };
}

let CONFIG = loadConfig();
let savedSheets = [];

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Step 1: Redirect to Google OAuth
app.get('/auth/google', (req, res) => {
  if (!oauth2Client) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    include_granted_scopes: true
  });

  res.redirect(authUrl);
});

// Step 2: Handle OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in session
    req.session.googleTokens = tokens;
    
    console.log('Google OAuth successful, tokens stored');
    
    // Redirect back to app
    res.redirect('/?connected=true');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?error=oauth_failed');
  }
});

// Check if user is authenticated with Google
app.get('/api/google/auth-status', (req, res) => {
  const isAuthenticated = !!(req.session.googleTokens && req.session.googleTokens.access_token);
  res.json({ 
    authenticated: isAuthenticated,
    hasTokens: !!req.session.googleTokens
  });
});

// Disconnect Google
app.post('/api/google/disconnect', (req, res) => {
  req.session.googleTokens = null;
  res.json({ success: true, message: 'Google account disconnected' });
});

// ============================================
// GOOGLE SHEETS API ROUTES (Using OAuth)
// ============================================

// List user's spreadsheets
app.get('/api/google/spreadsheets', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }

  try {
    oauth2Client.setCredentials(req.session.googleTokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc'
    });

    res.json({
      success: true,
      spreadsheets: response.data.files
    });
  } catch (error) {
    console.error('Error listing spreadsheets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Read sheet data using Google Sheets API
app.get('/api/google/sheet/:spreadsheetId', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }

  const { spreadsheetId } = req.params;
  const range = req.query.range || 'Sheet1';

  try {
    oauth2Client.setCredentials(req.session.googleTokens);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.json({ headers: [], data: [] });
    }

    // Parse headers and data
    const headers = rows[0];
    const data = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = { _rowIndex: i + 1 };
      headers.forEach((header, index) => {
        const key = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
        row[key] = rows[i][index] || '';
      });
      data.push(row);
    }

    res.json({ headers, data });
  } catch (error) {
    console.error('Error reading sheet:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update cell in sheet
app.post('/api/google/sheet/:spreadsheetId/update', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }

  const { spreadsheetId } = req.params;
  const { range, values } = req.body;

  try {
    oauth2Client.setCredentials(req.session.googleTokens);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating sheet:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// EXISTING API ROUTES (Legacy CSV method)
// ============================================

// Get current sheet URL
app.get('/api/sheet-url', (req, res) => {
  res.json({ 
    url: CONFIG.SHEET_URL,
    name: 'Spreadsheet',
    configured: !!CONFIG.SHEET_URL
  });
});

// Update sheet URL
app.post('/api/sheet-url', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  CONFIG.SHEET_URL = url;
  res.json({ success: true, url, configured: true });
});

// Delete sheet URL
app.delete('/api/sheet-url', (req, res) => {
  CONFIG.SHEET_URL = '';
  res.json({ success: true });
});

// Get saved sheets
app.get('/api/sheets', (req, res) => {
  res.json(savedSheets);
});

// Add sheet
app.post('/api/sheets', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const sheet = { id: Date.now().toString(), url, name: name || 'Sheet', addedAt: new Date().toISOString() };
  savedSheets.push(sheet);
  CONFIG.SHEET_URL = url;
  res.json({ success: true, sheet });
});

// Delete sheet
app.delete('/api/sheets/:id', (req, res) => {
  savedSheets = savedSheets.filter(s => s.id !== req.params.id);
  res.json({ success: true });
});

// Switch sheet
app.post('/api/sheets/:id/switch', (req, res) => {
  const sheet = savedSheets.find(s => s.id === req.params.id);
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  CONFIG.SHEET_URL = sheet.url;
  res.json({ success: true, sheet });
});

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
    const values = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i], nextChar = line[i + 1];
      if (inQuotes) {
        if (char === '"') { if (nextChar === '"') { current += '"'; i++; } else inQuotes = false; }
        else current += char;
      } else {
        if (char === '"') inQuotes = true;
        else if (char === ',') { values.push(current.trim()); current = ''; }
        else current += char;
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
    headers.forEach((header, index) => { row[header.toLowerCase().replace(/[^a-z0-9]/g, '_')] = values[index] || ''; });
    data.push(row);
  }
  return { headers, data };
}

// Get sheet data
app.get('/api/sheet', async (req, res) => {
  try {
    if (!CONFIG.SHEET_URL) return res.status(400).json({ error: 'No sheet URL configured' });
    const spreadsheetId = extractSpreadsheetId(CONFIG.SHEET_URL);
    if (!spreadsheetId) return res.status(400).json({ error: 'Invalid sheet URL' });
    let exportUrl = spreadsheetId.startsWith('e/') 
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv`
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
    const response = await axios.get(exportUrl, { timeout: 10000 });
    res.json(parseCSV(response.data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate content
app.post('/api/generate-content', async (req, res) => {
  const { topic } = req.body;
  res.json({
    success: true,
    title: `${topic}: A Comprehensive Guide`,
    content: `# ${topic} Guide\n\nContent here...`,
    excerpt: `Learn about ${topic}`,
    tags: topic.toLowerCase()
  });
});

// Generate image
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await axios.post(
      `${CONFIG.LAOZHANG_BASE_URL}/images/generations`,
      { model: CONFIG.LAOZHANG_MODEL, prompt, n: 1, size: '1200x630', quality: 'high' },
      { headers: { 'Authorization': `Bearer ${CONFIG.LAOZHANG_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000, responseType: 'arraybuffer' }
    );
    res.json({ success: true, imageBase64: Buffer.from(response.data).toString('base64'), mimeType: 'image/png' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image
app.post('/api/upload-image', async (req, res) => {
  try {
    const { imageBase64, filename } = req.body;
    const filePath = `images/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    const response = await axios.put(
      `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${filePath}`,
      { message: 'Upload image', content: imageBase64, branch: CONFIG.GITHUB_BRANCH },
      { headers: { 'Authorization': `token ${CONFIG.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    res.json({ success: true, url: response.data.content.download_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Publish to WordPress
app.post('/api/publish', async (req, res) => {
  try {
    const { title, content, excerpt } = req.body;
    const response = await axios.post(
      `${CONFIG.WP_URL}/wp-json/wp/v2/posts`,
      { title, content, excerpt: excerpt || '', status: 'publish' },
      { auth: { username: CONFIG.WP_USERNAME, password: CONFIG.WP_APP_PASSWORD } }
    );
    res.json({ success: true, postId: response.data.id, url: response.data.link });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH & CONFIG
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), googleAuth: !!oauth2Client });
});

// Get config
app.get('/api/config', (req, res) => {
  res.json({
    SHEET_URL: CONFIG.SHEET_URL,
    LAOZHANG_BASE_URL: CONFIG.LAOZHANG_BASE_URL,
    LAOZHANG_MODEL: CONFIG.LAOZHANG_MODEL,
    GITHUB_REPO: CONFIG.GITHUB_REPO,
    GITHUB_BRANCH: CONFIG.GITHUB_BRANCH,
    WP_URL: CONFIG.WP_URL,
    WP_USERNAME: CONFIG.WP_USERNAME,
    sheetConfigured: !!CONFIG.SHEET_URL
  });
});

// Serve frontend - MUST BE LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

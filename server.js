const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const GoogleOAuthService = require('./google-oauth-service');

const app = express();
const PORT = process.env.PORT || 3000;
const googleService = new GoogleOAuthService();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store tokens (load from env if available)
let storedTokens = null;
try {
  if (process.env.GOOGLE_OAUTH_TOKENS) {
    storedTokens = JSON.parse(process.env.GOOGLE_OAUTH_TOKENS);
    console.log('Loaded tokens from env');
  }
} catch (e) {
  console.error('Failed to load tokens from env:', e.message);
}

// Hardcoded config
const CONFIG = {
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRdkdttxEJQt-kWPgBBsehHymf8inl5wO0N_NoVqS5lNKhavDgqDVgni7HSfA-CE8d8VmjqHw5MMBuk/pub?output=csv',
  LAOZHANG_API_KEY: process.env.LAOZHANG_API_KEY || '',
  LAOZHANG_BASE_URL: 'https://api.laozhang.ai/v1',
  LAOZHANG_MODEL: 'gemini-3-pro-image-preview',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_REPO: process.env.GITHUB_REPO || 'xBalzerian/WordpressAutoClaw',
  GITHUB_BRANCH: 'main'
};

// WordPress config (load from env or defaults)
let WP_CONFIG = {
  url: process.env.WP_URL || '',
  username: process.env.WP_USERNAME || '',
  password: process.env.WP_APP_PASSWORD || ''
};

// Load saved WP config from env if available
try {
  if (process.env.WP_URL) {
    WP_CONFIG.url = process.env.WP_URL;
    console.log('Loaded WP URL from env');
  }
  if (process.env.WP_USERNAME) {
    WP_CONFIG.username = process.env.WP_USERNAME;
  }
  if (process.env.WP_APP_PASSWORD) {
    WP_CONFIG.password = process.env.WP_APP_PASSWORD;
  }
} catch (e) {
  console.error('Failed to load WP config from env:', e.message);
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
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  return { headers, data };
}

// Detect columns
function detectColumns(headers) {
  const detected = {
    serviceUrl: null,
    mainKeyword: null,
    clusterKeywords: null,
    gdocsLink: null,
    wpPostUrl: null,
    status: null,
    featureImage: null,
    supportImage1: null,
    supportImage2: null
  };

  headers.forEach(header => {
    const lower = header.toLowerCase();
    
    if (!detected.serviceUrl && lower.includes('service') && lower.includes('url')) {
      detected.serviceUrl = header;
    }
    if (!detected.mainKeyword && (lower.includes('main') || lower.includes('keyword'))) {
      detected.mainKeyword = header;
    }
    if (!detected.clusterKeywords && lower.includes('cluster')) {
      detected.clusterKeywords = header;
    }
    if (!detected.gdocsLink && lower.includes('gdoc')) {
      detected.gdocsLink = header;
    }
    if (!detected.wpPostUrl && lower.includes('wp') && lower.includes('url')) {
      detected.wpPostUrl = header;
    }
    if (!detected.status && lower.includes('status')) {
      detected.status = header;
    }
    if (!detected.featureImage && lower.includes('feature')) {
      detected.featureImage = header;
    }
    if (!detected.supportImage1 && lower.includes('support') && lower.includes('1')) {
      detected.supportImage1 = header;
    }
    if (!detected.supportImage2 && lower.includes('support') && lower.includes('2')) {
      detected.supportImage2 = header;
    }
  });

  return detected;
}

// Get sheet data
app.get('/api/sheet', async (req, res) => {
  try {
    const response = await axios.get(CONFIG.SHEET_URL, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const parsed = parseCSV(response.data);
    const columns = detectColumns(parsed.headers);
    
    res.json({
      headers: parsed.headers,
      data: parsed.data,
      columns: columns
    });
  } catch (error) {
    console.error('Sheet error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fetch existing WordPress content
app.get('/api/fetch-wp-content', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    console.log('[Fetch WP] Fetching content from:', url);
    
    // Extract slug from URL
    const slugMatch = url.match(/\/services\/([^\/]+)/);
    if (!slugMatch) {
      return res.status(400).json({ error: 'Could not extract slug from URL' });
    }
    
    const slug = slugMatch[1];
    console.log('[Fetch WP] Extracted slug:', slug);
    
    // Try to fetch from WordPress REST API
    let content = null;
    let title = null;
    
    // Try services post type first
    try {
      const serviceResponse = await axios.get(
        `${WP_CONFIG.url}/wp-json/wp/v2/services?slug=${slug}`,
        { auth: { username: WP_CONFIG.username, password: WP_CONFIG.password } }
      );
      if (serviceResponse.data && serviceResponse.data.length > 0) {
        content = serviceResponse.data[0].content?.rendered || '';
        title = serviceResponse.data[0].title?.rendered || '';
        console.log('[Fetch WP] Found service content:', content.length, 'chars');
      }
    } catch (e) {
      console.log('[Fetch WP] Service not found, trying pages...');
    }
    
    // Try pages if not found
    if (!content) {
      try {
        const pageResponse = await axios.get(
          `${WP_CONFIG.url}/wp-json/wp/v2/pages?slug=${slug}`,
          { auth: { username: WP_CONFIG.username, password: WP_CONFIG.password } }
        );
        if (pageResponse.data && pageResponse.data.length > 0) {
          content = pageResponse.data[0].content?.rendered || '';
          title = pageResponse.data[0].title?.rendered || '';
          console.log('[Fetch WP] Found page content:', content.length, 'chars');
        }
      } catch (e) {
        console.log('[Fetch WP] Page not found, trying posts...');
      }
    }
    
    // Try posts if still not found
    if (!content) {
      try {
        const postResponse = await axios.get(
          `${WP_CONFIG.url}/wp-json/wp/v2/posts?slug=${slug}`,
          { auth: { username: WP_CONFIG.username, password: WP_CONFIG.password } }
        );
        if (postResponse.data && postResponse.data.length > 0) {
          content = postResponse.data[0].content?.rendered || '';
          title = postResponse.data[0].title?.rendered || '';
          console.log('[Fetch WP] Found post content:', content.length, 'chars');
        }
      } catch (e) {
        console.log('[Fetch WP] Post not found');
      }
    }
    
    if (content) {
      res.json({ 
        success: true, 
        content: content,
        title: title,
        slug: slug
      });
    } else {
      res.status(404).json({ 
        error: 'Content not found',
        slug: slug
      });
    }
  } catch (error) {
    console.error('[Fetch WP] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Generate content with Kimi + Create Google Doc + Update Sheet
app.post('/api/generate-content', async (req, res) => {
  try {
    const { keyword, serviceUrl, rowIndex, spreadsheetId, clusterKeywords, existingContent } = req.body;
    
    // Check if authenticated
    if (!storedTokens) {
      return res.status(401).json({ 
        error: 'Not authenticated with Google. Please visit /auth/google first.' 
      });
    }
    
    // Set credentials
    googleService.setCredentialsFromTokens(storedTokens);
    
    // Check if GDoc already exists for this row
    let existingDocUrl = null;
    if (rowIndex && spreadsheetId) {
      try {
        const sheetData = await googleService.getSpreadsheetData(spreadsheetId, `D${rowIndex}`);
        if (sheetData && sheetData.values && sheetData.values[0] && sheetData.values[0][0]) {
          existingDocUrl = sheetData.values[0][0];
          if (existingDocUrl.includes('docs.google.com')) {
            console.log('Existing GDoc found:', existingDocUrl);
          }
        }
      } catch (e) {
        console.log('Could not check existing doc:', e.message);
      }
    }
    
    // Generate optimized content (with existing content if provided)
    const content = generateOptimizedContent(keyword, clusterKeywords, existingContent);
    
    let docResult;
    
    if (existingDocUrl) {
      // Update existing doc
      const docId = existingDocUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (docId) {
        docResult = await googleService.updateGoogleDoc(docId, content.fullContent);
        docResult.docUrl = existingDocUrl;
        console.log('Updated existing Google Doc:', existingDocUrl);
      }
    }
    
    if (!docResult || !docResult.success) {
      // Create new Google Doc via OAuth
      const docTitle = `${keyword} | Huntington Beach, CA`;
      docResult = await googleService.createGoogleDoc(docTitle, content.fullContent);
    }
    
    if (!docResult.success) {
      return res.status(500).json({ error: 'Failed to create Google Doc: ' + docResult.error });
    }
    
    // Update spreadsheet with GDoc link
    const actualSpreadsheetId = spreadsheetId || process.env.SPREADSHEET_ID;
    if (actualSpreadsheetId && rowIndex) {
      // Find GDocs Link column letter (column D)
      const gdocsColumn = 'D';
      const range = `${gdocsColumn}${rowIndex}`;
      
      const sheetResult = await googleService.updateSpreadsheet(
        actualSpreadsheetId,
        range,
        [[docResult.docUrl]]
      );
      
      if (!sheetResult.success) {
        console.error('Failed to update spreadsheet:', sheetResult.error);
        return res.status(500).json({ 
          error: 'Doc created but spreadsheet update failed: ' + sheetResult.error,
          docUrl: docResult.docUrl,
          docId: docResult.docId
        });
      } else {
        console.log('Spreadsheet updated successfully:', sheetResult.updatedRange);
      }
    }
    
    res.json({
      success: true,
      title: keyword,
      content: content,
      docUrl: docResult.docUrl,
      docId: docResult.docId,
      excerpt: content.excerpt,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
      focusKeyword: keyword
    });
  } catch (error) {
    console.error('Generate content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  const authUrl = googleService.getAuthUrl();
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }
  
  try {
    const tokens = await googleService.setCredentials(code);
    storedTokens = tokens;
    console.log('Tokens received:', JSON.stringify(tokens));
    res.send('Authentication successful! Tokens: ' + JSON.stringify(tokens) + '<br><br>Copy the tokens above and add to GOOGLE_OAUTH_TOKENS env var in Render.');
  } catch (error) {
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

// Update spreadsheet with doc link
app.post('/api/update-spreadsheet', async (req, res) => {
  try {
    const { rowIndex, docUrl } = req.body;
    
    if (!storedTokens) {
      return res.status(401).json({ 
        error: 'Not authenticated with Google. Please visit /auth/google first.' 
      });
    }
    
    googleService.setCredentialsFromTokens(storedTokens);
    
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'SPREADSHEET_ID not configured' });
    }
    
    // Update GDocs Link column (column D)
    const range = `D${rowIndex}`;
    
    const sheetResult = await googleService.updateSpreadsheet(
      spreadsheetId,
      range,
      [[docUrl]]
    );
    
    if (sheetResult.success) {
      res.json({ success: true, message: 'Spreadsheet updated', range: sheetResult.updatedRange });
    } else {
      res.status(500).json({ error: sheetResult.error });
    }
  } catch (error) {
    console.error('Update spreadsheet error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate images for a service (runs in background)
app.post('/api/generate-images', async (req, res) => {
  try {
    const { keyword, rowIndex } = req.body;
    
    if (!CONFIG.LAOZHANG_API_KEY) {
      return res.status(400).json({ error: 'Laozhang API key not configured' });
    }
    
    // Start background process
    generateImagesInBackground(keyword, rowIndex);
    
    res.json({
      success: true,
      message: 'Image generation started in background. Links will appear in spreadsheet columns G, H, I when complete.'
    });
  } catch (error) {
    console.error('Generate images error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Background image generation
async function generateImagesInBackground(keyword, rowIndex) {
  try {
    const serviceName = keyword;
    const safeName = serviceName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    
    console.log(`[Background] Starting image generation for: ${serviceName}`);
    
    // Generate 3 images
    const images = [];
    
    // Image 1: Feature Image
    const prompt1 = `Professional medical illustration of ${serviceName}, clean modern design, soft blue and white color scheme, anatomical accuracy, medical textbook style, high quality, 4K, suitable for medical website header`;
    
    // Image 2: Support Image 1 (Procedure)
    const prompt2 = `Step-by-step ${serviceName} procedure diagram, medical illustration, clean infographic style, professional medical artwork, soft colors, educational diagram, high resolution`;
    
    // Image 3: Support Image 2 (Results)
    const prompt3 = `${serviceName} recovery results, before and after medical illustration, professional medical photography style, clean background, patient satisfaction concept, high quality medical artwork`;
    
    const prompts = [
      { prompt: prompt1, type: 'feature' },
      { prompt: prompt2, type: 'support-1' },
      { prompt: prompt3, type: 'support-2' }
    ];
    
    for (const { prompt, type } of prompts) {
      try {
        console.log(`[Background] Generating ${type} image...`);
        
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
            timeout: 120000
          }
        );
        
        // Laozhang API returns JSON with base64 data
        let base64;
        if (response.data && response.data.data && response.data.data[0] && response.data.data[0].b64_json) {
          // OpenAI/Laozhang format
          base64 = response.data.data[0].b64_json;
        } else if (response.data && response.data.b64_json) {
          base64 = response.data.b64_json;
        } else if (typeof response.data === 'string') {
          base64 = response.data;
        } else {
          console.error('[Background] Unexpected response format:', response.data);
          throw new Error('Unexpected API response format');
        }
        
        console.log(`[Background] Got base64 data, length: ${base64.length}`);
        
        // Upload to GitHub
        const timestamp = Date.now();
        const filename = `${safeName}-${type}-${timestamp}.png`;
        const folderPath = `images/${safeName}`;
        
        if (CONFIG.GITHUB_TOKEN) {
          const githubResponse = await axios.put(
            `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${folderPath}/${filename}`,
            {
              message: `Upload ${type} image for ${serviceName}`,
              content: base64,
              branch: CONFIG.GITHUB_BRANCH
            },
            {
              headers: {
                'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            }
          );
          
          images.push({
            type: type,
            url: githubResponse.data.content.download_url,
            filename: filename
          });
          console.log(`[Background] ${type} image uploaded:`, githubResponse.data.content.download_url);
        }
      } catch (imgError) {
        console.error(`[Background] Failed to generate ${type} image:`, imgError.message);
        images.push({
          type: type,
          error: imgError.message
        });
      }
    }
    
    // Update spreadsheet with image URLs
    if (rowIndex && CONFIG.GITHUB_TOKEN && storedTokens) {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      if (spreadsheetId) {
        googleService.setCredentialsFromTokens(storedTokens);
        
        // Update columns G, H, I
        const featureImage = images.find(img => img.type === 'feature')?.url || '';
        const supportImage1 = images.find(img => img.type === 'support-1')?.url || '';
        const supportImage2 = images.find(img => img.type === 'support-2')?.url || '';
        
        await googleService.updateSpreadsheet(spreadsheetId, `G${rowIndex}`, [[featureImage]]);
        await googleService.updateSpreadsheet(spreadsheetId, `H${rowIndex}`, [[supportImage1]]);
        await googleService.updateSpreadsheet(spreadsheetId, `I${rowIndex}`, [[supportImage2]]);
        
        console.log('[Background] Spreadsheet updated with image URLs');
      }
    }
    
    console.log(`[Background] Image generation complete for: ${serviceName}`);
  } catch (error) {
    console.error('[Background] Image generation failed:', error.message);
  }
}

// Upload image to GitHub
app.post('/api/upload-image', async (req, res) => {
  try {
    const { imageBase64, filename, path: folderPath } = req.body;
    
    if (!CONFIG.GITHUB_TOKEN) {
      return res.status(400).json({ error: 'GitHub token not configured' });
    }
    
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
    const filePath = `${folderPath}/${timestamp}-${safeFilename}`;

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
      path: filePath
    });
  } catch (error) {
    console.error('GitHub error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Publish to WordPress
app.post('/api/publish', async (req, res) => {
  try {
    const { 
      title, 
      content, 
      excerpt, 
      metaTitle, 
      metaDescription, 
      focusKeyword,
      featureImageUrl,
      supportImage1Url,
      supportImage2Url
    } = req.body;

    if (!WP_CONFIG.url || !WP_CONFIG.username || !WP_CONFIG.password) {
      return res.status(400).json({ error: 'WordPress not configured' });
    }

    // Build content with images
    let fullContent = content;
    
    // Insert support images before major H2s
    if (supportImage1Url) {
      fullContent = fullContent.replace(
        '## Who is a good candidate?',
        `![${focusKeyword} - Who is a good candidate](${supportImage1Url})\n\n## Who is a good candidate?`
      );
    }
    
    if (supportImage2Url) {
      fullContent = fullContent.replace(
        '## Procedure in Detail',
        `![${focusKeyword} - Procedure](${supportImage2Url})\n\n## Procedure in Detail`
      );
    }

    // Create post
    const postData = {
      title: title,
      content: fullContent,
      excerpt: excerpt,
      status: 'publish',
      meta: {
        _yoast_wpseo_title: metaTitle,
        _yoast_wpseo_metadesc: metaDescription,
        _yoast_wpseo_focuskw: focusKeyword,
        _yoast_wpseo_opengraph_title: metaTitle,
        _yoast_wpseo_opengraph_description: metaDescription,
        _yoast_wpseo_opengraph_image: featureImageUrl || ''
      }
    };

    const response = await axios.post(
      `${WP_CONFIG.url}/wp-json/wp/v2/posts`,
      postData,
      {
        auth: {
          username: WP_CONFIG.username,
          password: WP_CONFIG.password
        }
      }
    );

    const postId = response.data.id;

    // Set featured image if provided
    if (featureImageUrl) {
      try {
        // Download image and upload to WP media
        const imageResponse = await axios.get(featureImageUrl, {
          responseType: 'arraybuffer'
        });
        
        const imageBase64 = Buffer.from(imageResponse.data).toString('base64');
        
        // Upload to WP media library
        const mediaResponse = await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media`,
          Buffer.from(imageResponse.data),
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            },
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${focusKeyword.replace(/\s+/g, '-')}-feature.png"`
            }
          }
        );

        // Set as featured image
        await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/posts/${postId}`,
          { featured_media: mediaResponse.data.id },
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            }
          }
        );
      } catch (imageError) {
        console.error('Featured image error:', imageError.message);
      }
    }

    res.json({
      success: true,
      postId: postId,
      url: response.data.link,
      title: response.data.title.rendered
    });
  } catch (error) {
    console.error('Publish error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update WordPress config
app.post('/api/wp-config', (req, res) => {
  const { url, username, password } = req.body;
  
  // Remove /wp-admin or /wp-login from URL if present
  let cleanUrl = url || WP_CONFIG.url;
  cleanUrl = cleanUrl.replace(/\/wp-admin.*$/, '').replace(/\/wp-login.*$/, '').replace(/\/$/, '');
  
  WP_CONFIG = {
    url: cleanUrl,
    username: username || WP_CONFIG.username,
    password: password || WP_CONFIG.password
  };
  
  res.json({ 
    success: true, 
    message: 'WordPress config updated', 
    url: cleanUrl,
    note: 'To make this permanent, add these to Render Environment Variables:\nWP_URL=' + cleanUrl + '\nWP_USERNAME=' + (username || WP_CONFIG.username) + '\nWP_APP_PASSWORD=' + (password || WP_CONFIG.password)
  });
});

// Disconnect WordPress
app.post('/api/wp-disconnect', (req, res) => {
  WP_CONFIG = {
    url: '',
    username: '',
    password: ''
  };
  res.json({ success: true, message: 'WordPress disconnected' });
});

// Get WP config
app.get('/api/wp-config', (req, res) => {
  res.json({
    url: WP_CONFIG.url,
    username: WP_CONFIG.username ? '***' : '',
    password: WP_CONFIG.password ? '***' : '',
    configured: !!(WP_CONFIG.url && WP_CONFIG.username && WP_CONFIG.password)
  });
});

// Test WordPress connection with debug
app.post('/api/wp-test', async (req, res) => {
  try {
    const { url, username, password } = req.body;
    
    console.log('Testing WP connection to:', url);
    console.log('Username:', username);
    
    // Clean the URL
    let cleanUrl = url.replace(/\/wp-admin.*$/, '').replace(/\/wp-login.*$/, '').replace(/\/$/, '');
    console.log('Clean URL:', cleanUrl);
    
    const response = await axios.get(`${cleanUrl}/wp-json/wp/v2/users`, {
      auth: { username, password },
      timeout: 10000
    });

    res.json({ success: true, users: response.data.length, url: cleanUrl });
  } catch (error) {
    console.error('WP Test Error:', error.message);
    console.error('Error response:', error.response?.data);
    console.error('Error status:', error.response?.status);
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data,
      status: error.response?.status
    });
  }
});

// Helper function to capitalize titles properly
function capitalizeTitle(str) {
  if (!str) return '';
  
  // Split by spaces and capitalize each word
  return str.split(' ').map(word => {
    if (!word) return '';
    // Capitalize first letter, lowercase the rest
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// SEO Optimizer - preserves original content, adds SEO wrapper
function optimizeContentForSEO(content, serviceName, location, clusterKeywords) {
  console.log(`[SEO] Optimizing content for "${serviceName}" in ${location}`);
  
  // Parse cluster keywords
  const clusterList = clusterKeywords.split(',').map(k => k.trim()).filter(k => k);
  const topClusters = clusterList.slice(0, 5);
  
  // Step 1: Clean up content (remove editor metadata, preserve valuable info)
  let cleanedContent = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*data-start="\d+"/g, '')
    .replace(/\s*data-end="\d+"/g, '')
    .replace(/\s*data-src="[^"]*"/g, '')
    .replace(/\s*data-srcset="[^"]*"/g, '')
    .replace(/\s*data-sizes="[^"]*"/g, '')
    .replace(/\s*data-eio-rwidth="\d+"/g, '')
    .replace(/\s*data-eio-rheight="\d+"/g, '')
    .replace(/\s*decoding="[^"]*"/g, '')
    .replace(/\s*fetchpriority="[^"]*"/g, '')
    .replace(/\s*srcset="[^"]*"/g, '')
    .replace(/\s*sizes="[^"]*"/g, '')
    .replace(/\s*target="_new"/g, ' target="_blank"')
    .replace(/\s*rel="noopener"/g, '')
    .replace(/\s+>/g, '>')
    .trim();
  
  // Step 2: Remove existing H1 (we'll add optimized one)
  cleanedContent = cleanedContent.replace(/<h1[^>]*>.*?<\/h1>/gi, '');
  
  // Step 3: Enhance existing H2s with keywords (preserve original meaning)
  // Only add keyword if H2 doesn't already have it
  const h2Pattern = /<h2[^>]*>(.*?)<\/h2>/gi;
  let h2Match;
  while ((h2Match = h2Pattern.exec(cleanedContent)) !== null) {
    const originalH2 = h2Match[0];
    const h2Text = h2Match[1];
    
    // Skip if already contains keyword
    if (h2Text.toLowerCase().includes(serviceName.toLowerCase())) continue;
    
    // Enhance specific H2 types
    let enhancedH2 = originalH2;
    if (/why consider|what is|about|overview/i.test(h2Text)) {
      enhancedH2 = `<h2>${serviceName}: ${h2Text}</h2>`;
    } else if (/benefits/i.test(h2Text)) {
      enhancedH2 = `<h2>Benefits of ${serviceName}</h2>`;
    } else if (/procedure|the process/i.test(h2Text)) {
      enhancedH2 = `<h2>The ${serviceName} Procedure</h2>`;
    } else if (/recovery|healing/i.test(h2Text)) {
      enhancedH2 = `<h2>${serviceName} Recovery</h2>`;
    } else if (/results/i.test(h2Text)) {
      enhancedH2 = `<h2>${serviceName} Results</h2>`;
    } else if (/cost|price/i.test(h2Text)) {
      enhancedH2 = `<h2>${serviceName} Cost in ${location}</h2>`;
    }
    
    cleanedContent = cleanedContent.replace(originalH2, enhancedH2);
  }
  
  // Step 4: Build SEO wrapper (adds to beginning and end, doesn't replace content)
  let optimized = '';
  
  // Check if keyword is in first paragraph
  const firstPara = cleanedContent.match(/<p[^>]*>(.*?)<\/p>/i);
  const hasKeywordInFirstPara = firstPara && firstPara[1].toLowerCase().includes(serviceName.toLowerCase());
  
  // Add SEO intro only if keyword is missing from first paragraph
  if (!hasKeywordInFirstPara) {
    optimized += `<p><strong>${serviceName} in ${location}</strong> helps patients achieve their aesthetic goals with natural-looking results. At Tran Plastic Surgery, <a href="https://tranplastic.com/about-dr-tran/">Dr. Tuan A. Tran</a> provides personalized care for patients throughout Orange County including Fountain Valley, Westminster, Garden Grove, Costa Mesa, and Newport Beach.</p>\n\n`;
  }
  
  // Step 5: Add the PRESERVED original content
  optimized += cleanedContent;
  
  // Step 6: Add location mention if missing
  if (!optimized.toLowerCase().includes('huntington beach')) {
    optimized += `\n\n<p>Our ${location} facility serves patients from throughout Orange County and nearby communities including Fountain Valley, Westminster, Garden Grove, Costa Mesa, and Newport Beach.</p>`;
  }
  
  // Step 7: Add Service Areas section if missing
  if (!optimized.includes('Service Areas') && !optimized.includes('service areas')) {
    optimized += `\n\n<h2>Service Areas</h2>\n<p>Tran Plastic Surgery is conveniently located in <strong>Huntington Beach, CA</strong>. We proudly serve patients from:</p>\n<ul>\n<li>Fountain Valley</li>\n<li>Westminster</li>\n<li>Garden Grove</li>\n<li>Costa Mesa</li>\n<li>Newport Beach</li>\n<li>And throughout Orange County</li>\n</ul>`;
  }
  
  // Step 8: Add FAQ section if missing (for schema markup)
  if (!optimized.includes('Frequently Asked') && !optimized.includes('FAQ')) {
    optimized += `\n\n<h2>Frequently Asked Questions About ${serviceName}</h2>\n\n<p><strong>What is ${serviceName}?</strong><br>\n${serviceName} is a cosmetic surgical procedure designed to enhance your appearance. Dr. Tuan A. Tran performs this procedure at our Huntington Beach facility.</p>\n\n<p><strong>How long does ${serviceName} take?</strong><br>\nThe procedure typically takes 1-3 hours depending on the complexity and extent of treatment.</p>\n\n<p><strong>What is the recovery time for ${serviceName}?</strong><br>\nMost patients return to light activities within 1-2 weeks, with full recovery in 4-6 weeks.</p>\n\n<p><strong>Are ${serviceName} results permanent?</strong><br>\nResults are long-lasting when you maintain a stable weight and healthy lifestyle.</p>\n\n<p><strong>How much does ${serviceName} cost in Huntington Beach?</strong><br>\nPricing varies based on procedure complexity. Contact us at (714) 839-8000 for a personalized consultation.</p>`;
  }
  
  // Step 9: Add Related Procedures
  const relatedServices = getRelatedServices(serviceName);
  if (relatedServices.length > 0 && !optimized.includes('Related Procedures')) {
    optimized += `\n\n<h2>Related Procedures</h2>\n<p>Patients considering ${serviceName} may also be interested in:</p>\n<ul>\n${relatedServices.map(s => `<li><a href="https://tranplastic.com/services/${s.slug}/">${s.name}</a></li>`).join('\n')}\n</ul>`;
  }
  
  // Step 10: Add final CTA if missing
  if (!optimized.includes('Schedule your consultation') && !optimized.includes('Call us today')) {
    optimized += `\n\n<h2>Schedule Your ${serviceName} Consultation</h2>\n<p>Ready to learn more about ${serviceName} in ${location}? Contact Tran Plastic Surgery today to schedule your private consultation with <a href="https://tranplastic.com/about-dr-tran/">Dr. Tuan A. Tran</a>.</p>\n<p>📞 Call: <a href="tel:+17148398000">(714) 839-8000</a><br>\n📍 Location: 20951 Brookhurst St Suite 107, Huntington Beach, CA 92646</p>`;
  }
  
  return {
    optimizedContent: optimized,
    topClusters: topClusters,
    h2Count: (optimized.match(/<h2/gi) || []).length,
    wordCount: optimized.replace(/<[^>]+>/g, ' ').split(/\s+/).length
  };
}

// Get related services for internal linking
function getRelatedServices(currentService) {
  const serviceMap = {
    'ear surgery': [
      { name: 'Facelift Surgery', slug: 'facelift-surgery' },
      { name: 'Eyelid Surgery', slug: 'eyelid-surgery' },
      { name: 'Neck Lift Surgery', slug: 'neck-lift-surgery' }
    ],
    'facelift surgery': [
      { name: 'Neck Lift Surgery', slug: 'neck-lift-surgery' },
      { name: 'Eyelid Surgery', slug: 'eyelid-surgery' },
      { name: 'Ear Surgery', slug: 'ear-surgery' }
    ],
    'eyelid surgery': [
      { name: 'Facelift Surgery', slug: 'facelift-surgery' },
      { name: 'Brow Lift', slug: 'brow-lift' },
      { name: 'Ear Surgery', slug: 'ear-surgery' }
    ],
    'neck lift surgery': [
      { name: 'Facelift Surgery', slug: 'facelift-surgery' },
      { name: 'Chin Augmentation', slug: 'chin-augmentation' },
      { name: 'Ear Surgery', slug: 'ear-surgery' }
    ],
    'tummy tuck': [
      { name: 'Liposuction', slug: 'liposuction' },
      { name: 'Mommy Makeover', slug: 'mommy-makeover' },
      { name: 'Body Lift', slug: 'body-lift' }
    ],
    'liposuction': [
      { name: 'Tummy Tuck', slug: 'tummy-tuck' },
      { name: 'Body Contouring', slug: 'body-contouring' },
      { name: 'Mommy Makeover', slug: 'mommy-makeover' }
    ],
    'breast augmentation': [
      { name: 'Breast Lift', slug: 'breast-lift' },
      { name: 'Breast Reduction', slug: 'breast-reduction' },
      { name: 'Mommy Makeover', slug: 'mommy-makeover' }
    ],
    'breast lift': [
      { name: 'Breast Augmentation', slug: 'breast-augmentation' },
      { name: 'Breast Reduction', slug: 'breast-reduction' },
      { name: 'Mommy Makeover', slug: 'mommy-makeover' }
    ],
    'breast reduction': [
      { name: 'Breast Augmentation', slug: 'breast-augmentation' },
      { name: 'Breast Lift', slug: 'breast-lift' },
      { name: 'Tummy Tuck', slug: 'tummy-tuck' }
    ],
    'mommy makeover': [
      { name: 'Tummy Tuck', slug: 'tummy-tuck' },
      { name: 'Breast Augmentation', slug: 'breast-augmentation' },
      { name: 'Liposuction', slug: 'liposuction' }
    ]
  };
  
  const normalizedService = currentService.toLowerCase().trim();
  return serviceMap[normalizedService] || [
    { name: 'View All Services', slug: '' }
  ];
}

// Generate optimized service content
function generateOptimizedContent(keyword, clusterKeywords = '', existingContent = '') {
  const serviceName = keyword;
  const capitalizedServiceName = capitalizeTitle(serviceName);
  const location = 'Huntington Beach, CA';
  const fullAddress = '20951 Brookhurst St Suite 107, Huntington Beach, CA 92646';
  
  // Parse cluster keywords for natural integration
  const clusterList = clusterKeywords.split(',').map(k => k.trim()).filter(k => k);
  const topClusters = clusterList.slice(0, 5);
  
  // SEO-Optimized Meta Description
  const metaDescription = `Get ${capitalizedServiceName} in ${location} by Dr. Tuan A. Tran, board-certified plastic surgeon. Natural-looking results, personalized care. Book your free consultation today!`.substring(0, 160);
  
  // If existing content is provided, use SEO optimizer
  if (existingContent && existingContent.length > 100) {
    console.log(`[Content] Running SEO optimization on existing content (${existingContent.length} chars)`);
    
    const optimization = optimizeContentForSEO(existingContent, serviceName, location, clusterKeywords);
    
    // Build final content with proper structure
    const h1Title = `<h1>${capitalizedServiceName} | ${location}</h1>`;
    
    const fullContent = `${h1Title}\n\n${optimization.optimizedContent}`;
    
    console.log(`[SEO] Optimization complete: ${optimization.wordCount} words, ${optimization.h2Count} H2s`);
    
    return {
      fullContent: fullContent,
      excerpt: `Learn about ${capitalizedServiceName} at Tran Plastic Surgery in ${location}. Board-certified surgeon Dr. Tuan A. Tran provides expert care.`,
      metaTitle: `${capitalizedServiceName} ${location} | Tran Plastic Surgery`,
      metaDescription: metaDescription,
      clusterKeywords: optimization.topClusters,
      stats: {
        wordCount: optimization.wordCount,
        h2Count: optimization.h2Count
      }
    };
  }
  
  // Fallback to generic template if no existing content
  console.log(`[Content] No existing content, using generic template`);
  
  // Short description - naturally include main keyword once
  const shortDescription = `${capitalizedServiceName} in ${location} removes excess skin and fat to create a smoother, more toned appearance. <a href="https://tranplastic.com/about-dr-tran/">Dr. Tuan A. Tran</a> and our board-certified team at Tran Plastic Surgery offer expert procedures with natural-looking results.`;
  
  // H1 for GDoc content (will be removed for WordPress)
  const h1Title = `<h1>${capitalizedServiceName} | ${location}</h1>`;
  
  // Build content with SEO optimization - using HTML format
  // Dr. Tran mentioned 3 times: Overview (with link), Candidate section, and FAQ
  const fullContent = `${h1Title}

<p>${shortDescription}</p>

<h2>Overview</h2>

<p>${serviceName} is a specialized cosmetic procedure designed to help patients achieve their desired aesthetic goals. At Tran Plastic Surgery in <strong>${location}</strong>, <a href="https://tranplastic.com/about-dr-tran/">Dr. Tuan A. Tran</a> provides expert care tailored to each individual.</p>

<p>This treatment addresses specific concerns and enhances your overall appearance. Patients in <strong>${location}</strong> and surrounding areas choose this procedure for its transformative results and confidence-boosting effects.</p>

<h2>Who is a Good Candidate?</h2>

<p>Ideal candidates are healthy adults with realistic expectations. During your consultation at our <strong>${location}</strong> facility, Dr. Tran will discuss your goals and medical history to determine if this procedure is right for you.</p>

<p><strong>You may be an ideal candidate if you:</strong></p>
<ul>
<li>Are in good overall health</li>
<li>Have realistic expectations about results</li>
<li>Are committed to following pre and post-operative instructions</li>
<li>Do not smoke, or are willing to quit before and after surgery</li>
</ul>

<h2>Procedure in Detail</h2>

<p>The procedure is typically performed as an outpatient surgery. Each treatment is customized based on your unique anatomy and aesthetic goals.</p>

<p><strong>The process involves:</strong></p>

<ol>
<li><strong>Anesthesia</strong> – General or local anesthesia with sedation ensures comfort throughout the procedure</li>
<li><strong>Incision Placement</strong> – Precise incisions are made based on your specific needs and desired outcome</li>
<li><strong>Tissue Manipulation</strong> – Underlying tissues are reshaped to create natural, harmonious contours</li>
<li><strong>Closure</strong> – Incisions are carefully closed with sutures for optimal healing and minimal scarring</li>
</ol>

<h2>Recovery</h2>

<p>Recovery varies by patient. Some discomfort is normal for several days following surgery.</p>

<p><strong>Common post-operative effects include:</strong></p>
<ul>
<li>Mild pain and discomfort</li>
<li>Swelling and bruising</li>
<li>Tightness in treated areas</li>
<li>Temporary numbness</li>
</ul>

<p>Following post-operative instructions ensures optimal healing. Most patients return to light activities within 1-2 weeks, with full recovery in 4-6 weeks.</p>

<h2>Results</h2>

<p>Once swelling subsides, you'll notice immediate improvements. Results are long-lasting with a stable weight and healthy lifestyle.</p>

<h2>Cost and Consultation</h2>

<p>Pricing varies based on procedure complexity. Many insurance plans may cover this procedure depending on your case.</p>

<p><strong>Schedule your consultation:</strong></p>
<ul>
<li>📞 Call: (714) 839-8000</li>
<li>🌐 Visit: www.tranplastic.com</li>
<li>📍 Location: ${fullAddress}</li>
</ul>

<h2>Service Areas</h2>

<p>While our primary office is in <strong>Huntington Beach, CA</strong>, we proudly serve patients throughout <strong>Orange County</strong> including Fountain Valley, Westminster, and surrounding communities.</p>

<hr>

<h2>Frequently Asked Questions</h2>

<p><strong>What is ${serviceName}?</strong><br>
A cosmetic surgical procedure to improve body contour and appearance, performed at our Huntington Beach facility by <a href="https://tranplastic.com/about-dr-tran/">Dr. Tuan A. Tran</a>, a board-certified plastic surgeon.</p>

<p><strong>How long does the procedure take?</strong><br>
Typically 1-3 hours depending on complexity and extent of treatment.</p>

<p><strong>What is the recovery time?</strong><br>
Most patients return to light activities within 1-2 weeks, with full recovery in 4-6 weeks.</p>

<p><strong>Are results permanent?</strong><br>
Results are long-lasting when you maintain a stable weight and healthy lifestyle.</p>

<p><strong>Will there be visible scars?</strong><br>
Incisions are strategically placed to minimize visibility. Scars fade over time.</p>`;

  return {
    fullContent: fullContent,
    excerpt: `Learn about ${serviceName} at Tran Plastic Surgery in ${location}. Board-certified surgeon Dr. Tuan A. Tran provides expert care.`,
    metaTitle: `${serviceName} ${location} | Tran Plastic Surgery`,
    metaDescription: metaDescription,
    clusterKeywords: topClusters
  };
}

// Update spreadsheet with image links
app.post('/api/update-images', async (req, res) => {
  try {
    const { rowIndex, featureImage, supportImage1, supportImage2 } = req.body;
    
    if (!storedTokens) {
      return res.status(401).json({ 
        error: 'Not authenticated with Google. Please visit /auth/google first.' 
      });
    }
    
    googleService.setCredentialsFromTokens(storedTokens);
    
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'SPREADSHEET_ID not configured' });
    }
    
    // Update columns G, H, I
    await googleService.updateSpreadsheet(spreadsheetId, `G${rowIndex}`, [[featureImage || '']]);
    await googleService.updateSpreadsheet(spreadsheetId, `H${rowIndex}`, [[supportImage1 || '']]);
    await googleService.updateSpreadsheet(spreadsheetId, `I${rowIndex}`, [[supportImage2 || '']]);
    
    res.json({ success: true, message: 'Image links updated in spreadsheet' });
  } catch (error) {
    console.error('Update images error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Kie.ai config
const KIE_CONFIG = {
  API_KEY: process.env.KIE_API_KEY || '',
  BASE_URL: 'https://api.kie.ai/api/v1',
  MODEL: 'nano-banana-2',
  CALLBACK_URL: process.env.KIE_CALLBACK_URL || 'https://wordpress-claw.onrender.com/api/kie-callback',
  ASPECT_RATIO: '21:9',
  RESOLUTION: '1K',
  OUTPUT_FORMAT: 'jpg'
};

// Store pending Kie tasks
const pendingKieTasks = new Map();

// Check pending tasks status (for debugging)
app.get('/api/kie-status', (req, res) => {
  const tasks = [];
  for (const [taskId, task] of pendingKieTasks) {
    tasks.push({
      taskId,
      ...task,
      age: Date.now() - task.createdAt
    });
  }
  res.json({
    pending: tasks.length,
    tasks: tasks
  });
});

// Generate images using Kie.ai
app.post('/api/generate-images-kie', async (req, res) => {
  try {
    const { keyword, rowIndex } = req.body;
    
    if (!KIE_CONFIG.API_KEY) {
      return res.status(400).json({ error: 'Kie API key not configured' });
    }
    
    const serviceName = keyword;
    const safeName = serviceName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    
    // Check for existing images in spreadsheet first
    let existingImages = { feature: null, 'support-1': null, 'support-2': null };
    try {
      const sheetResponse = await axios.get(
        `${req.protocol}://${req.get('host')}/api/sheet`,
        { timeout: 10000 }
      );
      const row = sheetResponse.data.data.find(r => r._rowIndex === rowIndex);
      if (row) {
        if (row['Feature Image'] && row['Feature Image'].includes('githubusercontent')) {
          existingImages.feature = row['Feature Image'];
          console.log(`[Kie] Found existing feature image for row ${rowIndex}`);
        }
        if (row['Support Image 1'] && row['Support Image 1'].includes('githubusercontent')) {
          existingImages['support-1'] = row['Support Image 1'];
          console.log(`[Kie] Found existing support-1 image for row ${rowIndex}`);
        }
        if (row['Support Image 2'] && row['Support Image 2'].includes('githubusercontent')) {
          existingImages['support-2'] = row['Support Image 2'];
          console.log(`[Kie] Found existing support-2 image for row ${rowIndex}`);
        }
      }
    } catch (e) {
      console.log('[Kie] Could not check existing images:', e.message);
    }
    
    // Generate 3 prompts
    const prompts = [
      {
        prompt: `Professional medical illustration of ${serviceName} showing the transformation concept. Split-view design: left side shows problem area marked for correction, right side shows improved result. Clean modern medical textbook style, soft blue and white color scheme. Include small inset showing procedure area. Anatomical accuracy with clear layers visible. Educational and professional, helping patients understand the procedure's purpose at a glance.`,
        type: 'feature'
      },
      {
        prompt: `Educational infographic showing 4-step ${serviceName} procedure in vertical layout. Step 1: Anesthesia administration with patient positioned. Step 2: Surgeon making precise incision. Step 3: Correction/treatment being performed. Step 4: Suture closure. Each step in separate panel with numbered circles. Clean medical illustration style, soft colors, professional artwork. Include small icons for each step. High resolution educational diagram.`,
        type: 'support-1'
      },
      {
        prompt: `Before and after comparison of ${serviceName} results. Left side: Before showing the concern area. Right side: After showing improved, natural-looking result. Include small recovery timeline icons at bottom showing healing progression. Clean professional medical photography style, soft lighting, neutral background. Show realistic results with natural appearance. Patient satisfaction concept. High quality medical artwork.`,
        type: 'support-2'
      }
    ];
    
    const taskIds = [];
    const skipped = [];
    
    // Create tasks only for missing images
    for (const { prompt, type } of prompts) {
      // Skip if image already exists
      if (existingImages[type]) {
        console.log(`[Kie] Skipping ${type} - already exists`);
        skipped.push({ type, url: existingImages[type] });
        continue;
      }
      
      try {
        console.log(`[Kie] Creating task for ${type} image...`);
        
        const response = await axios.post(
          `${KIE_CONFIG.BASE_URL}/jobs/createTask`,
          {
            model: KIE_CONFIG.MODEL,
            callBackUrl: KIE_CONFIG.CALLBACK_URL,
            input: {
              prompt: prompt,
              aspect_ratio: KIE_CONFIG.ASPECT_RATIO,
              resolution: KIE_CONFIG.RESOLUTION,
              output_format: KIE_CONFIG.OUTPUT_FORMAT,
              google_search: false
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${KIE_CONFIG.API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
        
        if (response.data && response.data.data && response.data.data.taskId) {
          const taskId = response.data.data.taskId;
          taskIds.push({ taskId, type, serviceName, rowIndex });
          
          // Store task info
          pendingKieTasks.set(taskId, {
            taskId,
            type,
            serviceName,
            rowIndex,
            status: 'pending',
            createdAt: Date.now()
          });
          
          console.log(`[Kie] Task created: ${taskId} for ${type}`);
        }
      } catch (err) {
        console.error(`[Kie] Failed to create task for ${type}:`, err.message);
      }
    }
    
    res.json({
      success: true,
      message: `Created ${taskIds.length} image generation tasks. ${skipped.length} images already exist.`,
      tasks: taskIds,
      skipped: skipped,
      total: taskIds.length + skipped.length
    });
  } catch (error) {
    console.error('[Kie] Generate images error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Kie.ai callback endpoint
app.post('/api/kie-callback', async (req, res) => {
  try {
    const { code, data } = req.body;
    
    if (code !== 200 || !data || data.state !== 'success') {
      console.error('[Kie Callback] Task failed:', req.body);
      return res.json({ received: true });
    }
    
    const taskId = data.taskId;
    const taskInfo = pendingKieTasks.get(taskId);
    
    if (!taskInfo) {
      console.log('[Kie Callback] Unknown task:', taskId);
      return res.json({ received: true });
    }
    
    console.log(`[Kie Callback] Task ${taskId} completed for ${taskInfo.type}`);
    
    // Parse result
    let resultUrls = [];
    try {
      const resultJson = JSON.parse(data.resultJson);
      resultUrls = resultJson.resultUrls || [];
    } catch (e) {
      console.error('[Kie Callback] Failed to parse result:', e);
      return res.json({ received: true });
    }
    
    if (resultUrls.length === 0) {
      console.error('[Kie Callback] No result URLs');
      return res.json({ received: true });
    }
    
    const imageUrl = resultUrls[0];
    
    // Download image
    console.log(`[Kie Callback] Downloading image from ${imageUrl}...`);
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000
    });
    
    const base64 = Buffer.from(imageResponse.data).toString('base64');
    
    // Upload to GitHub
    if (CONFIG.GITHUB_TOKEN) {
      const timestamp = Date.now();
      const safeName = taskInfo.serviceName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const filename = `${safeName}-${taskInfo.type}-${timestamp}.jpg`;
      const folderPath = `images/${safeName}`;
      
      const githubResponse = await axios.put(
        `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${folderPath}/${filename}`,
        {
          message: `Upload ${taskInfo.type} image for ${taskInfo.serviceName}`,
          content: base64,
          branch: CONFIG.GITHUB_BRANCH
        },
        {
          headers: {
            'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );
      
      const githubUrl = githubResponse.data.content.download_url;
      console.log(`[Kie Callback] Uploaded to GitHub: ${githubUrl}`);
      
      // Store the URL in task info
      taskInfo.githubUrl = githubUrl;
      taskInfo.status = 'completed';
      pendingKieTasks.set(taskId, taskInfo);
      
      // Update spreadsheet immediately for this image
      await updateSpreadsheetWithImage(taskInfo.rowIndex, taskInfo.type, githubUrl);
      
      // Check if all 3 images are done for cleanup
      await checkAndCleanupTasks(taskInfo.rowIndex, taskInfo.serviceName);
    }
    
    res.json({ received: true, processed: true });
  } catch (error) {
    console.error('[Kie Callback] Error:', error.message);
    // Mark task as failed so it can be retried
    if (taskInfo) {
      taskInfo.status = 'failed';
      taskInfo.error = error.message;
      pendingKieTasks.set(taskId, taskInfo);
    }
    res.json({ received: true, error: error.message });
  }
});

// Update spreadsheet immediately when an image is ready
async function updateSpreadsheetWithImage(rowIndex, imageType, githubUrl) {
  try {
    if (!storedTokens) {
      console.log('[Kie] No tokens available for spreadsheet update');
      return;
    }
    
    googleService.setCredentialsFromTokens(storedTokens);
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      console.log('[Kie] No spreadsheet ID configured');
      return;
    }
    
    // Determine column based on image type
    let column;
    switch(imageType) {
      case 'feature':
        column = 'G';
        break;
      case 'support-1':
        column = 'H';
        break;
      case 'support-2':
        column = 'I';
        break;
      default:
        console.log(`[Kie] Unknown image type: ${imageType}`);
        return;
    }
    
    await googleService.updateSpreadsheet(spreadsheetId, `${column}${rowIndex}`, [[githubUrl]]);
    console.log(`[Kie] Updated spreadsheet ${column}${rowIndex} with ${imageType} image`);
  } catch (error) {
    console.error(`[Kie] Failed to update spreadsheet for ${imageType}:`, error.message);
  }
}

// Check if all images are done and cleanup tasks
async function checkAndCleanupTasks(rowIndex, serviceName) {
  try {
    // Find all completed tasks for this service
    const completedTasks = [];
    for (const [taskId, task] of pendingKieTasks) {
      if (task.serviceName === serviceName && task.status === 'completed' && task.rowIndex === rowIndex) {
        completedTasks.push(task);
      }
    }
    
    // Need all 3 types to cleanup
    const hasFeature = completedTasks.find(t => t.type === 'feature');
    const hasSupport1 = completedTasks.find(t => t.type === 'support-1');
    const hasSupport2 = completedTasks.find(t => t.type === 'support-2');
    
    if (hasFeature && hasSupport1 && hasSupport2) {
      console.log(`[Kie] All 3 images completed for ${serviceName}, cleaning up tasks...`);
      
      // Clean up tasks
      for (const task of completedTasks) {
        pendingKieTasks.delete(task.taskId);
      }
    }
  } catch (error) {
    console.error('[Kie] Cleanup error:', error.message);
  }
}

// Command endpoint for Auto Post by keyword
app.post('/api/command/post', async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }

    console.log('[Command] Auto post requested for:', keyword);

    // Fetch spreadsheet data
    const sheetResponse = await axios.get(`${WP_CONFIG.url ? WP_CONFIG.url.replace('https://tranplastic.com', 'https://wordpress-claw.onrender.com') : 'https://wordpress-claw.onrender.com'}/api/sheet`);
    const { data } = sheetResponse.data;

    // Find row by keyword
    const row = data.find(r => 
      r['Main Keyword']?.toLowerCase() === keyword.toLowerCase() ||
      r['Main Keyword']?.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!row) {
      return res.status(404).json({ error: `Service not found: ${keyword}` });
    }

    console.log('[Command] Found row:', row['Main Keyword']);

    // Call the update function
    const updateData = {
      title: row['Main Keyword'],
      serviceUrl: row['Service URL'],
      gdocUrl: row['GDocs Link'],
      focusKeyword: row['Main Keyword'],
      featureImageUrl: row['Feature Image'],
      supportImage1Url: row['Support Image 1'],
      supportImage2Url: row['Support Image 2'],
      rowIndex: row._rowIndex
    };

    // Make internal request to update-service-page
    const updateRes = await axios.post(
      `http://localhost:${PORT}/api/update-service-page`,
      updateData,
      { headers: { 'Content-Type': 'application/json' } }
    );

    res.json({
      success: true,
      message: `Posted: ${row['Main Keyword']}`,
      result: updateRes.data
    });
  } catch (error) {
    console.error('[Command] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update WordPress Service Page
app.post('/api/update-service-page', async (req, res) => {
  console.log('[WP] Update service page endpoint called');
  console.log('[WP] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { 
      title,
      serviceUrl,
      gdocUrl,
      focusKeyword,
      featureImageUrl,
      supportImage1Url,
      supportImage2Url,
      rowIndex
    } = req.body;

    console.log('[WP] Extracted data:', { title, serviceUrl, gdocUrl, focusKeyword, rowIndex });

    if (!WP_CONFIG.url || !WP_CONFIG.username || !WP_CONFIG.password) {
      console.log('[WP] WP not configured');
      return res.status(400).json({ error: 'WordPress not configured' });
    }

    // Fetch content from Google Doc
    let content = '';
    if (gdocUrl && storedTokens) {
      console.log('[WP] Fetching content from GDoc:', gdocUrl);
      googleService.setCredentialsFromTokens(storedTokens);
      const docResult = await googleService.getGoogleDocContent(gdocUrl);
      if (docResult.success) {
        content = docResult.content;
        console.log('[WP] GDoc content fetched, length:', content.length);
      } else {
        console.log('[WP] Failed to fetch GDoc content:', docResult.error);
      }
    } else {
      console.log('[WP] No GDoc URL or tokens available');
    }

    // Extract CURRENT post/page ID from service URL (using existing slug)
    let postId = null;
    let currentSlug = null;
    let postType = 'services'; // Default to services post type
    
    if (serviceUrl) {
      const match = serviceUrl.match(/\/services\/([^\/]+)/);
      if (match) {
        currentSlug = match[1];
        console.log('[WP] Looking for service with slug:', currentSlug);
        
        // Try services post type first (custom post type)
        try {
          const serviceResponse = await axios.get(
            `${WP_CONFIG.url}/wp-json/wp/v2/services?slug=${currentSlug}`,
            {
              auth: {
                username: WP_CONFIG.username,
                password: WP_CONFIG.password
              }
            }
          );
          if (serviceResponse.data && serviceResponse.data.length > 0) {
            postId = serviceResponse.data[0].id;
            postType = 'services';
            console.log('[WP] Found SERVICE ID:', postId);
          }
        } catch (e) {
          console.log('[WP] Service not found, trying pages...');
        }
        
        // If not found as service, try Pages
        if (!postId) {
          try {
            const pageResponse = await axios.get(
              `${WP_CONFIG.url}/wp-json/wp/v2/pages?slug=${currentSlug}`,
              {
                auth: {
                  username: WP_CONFIG.username,
                  password: WP_CONFIG.password
                }
              }
            );
            if (pageResponse.data && pageResponse.data.length > 0) {
              postId = pageResponse.data[0].id;
              postType = 'pages';
              console.log('[WP] Found PAGE ID:', postId);
            }
          } catch (e) {
            console.log('[WP] Page not found, trying posts...');
          }
        }
        
        // If not found as page, try Posts
        if (!postId) {
          try {
            const postResponse = await axios.get(
              `${WP_CONFIG.url}/wp-json/wp/v2/posts?slug=${currentSlug}`,
              {
                auth: {
                  username: WP_CONFIG.username,
                  password: WP_CONFIG.password
                }
              }
            );
            if (postResponse.data && postResponse.data.length > 0) {
              postId = postResponse.data[0].id;
              postType = 'posts';
              console.log('[WP] Found POST ID:', postId);
            }
          } catch (e) {
            console.log('[WP] Error finding post:', e.message);
          }
        }
        
        if (!postId) {
          console.log('[WP] No service, page or post found with slug:', currentSlug);
        }
      } else {
        console.log('[WP] Could not extract slug from URL:', serviceUrl);
      }
    }

    if (!postId) {
      return res.status(404).json({ error: `Service page not found for slug: ${currentSlug}. Please check the Service URL.` });
    }

    // Capitalize function for titles
    function capitalizeWords(str) {
      return str.replace(/\b\w/g, char => char.toUpperCase());
    }
    
    const capitalizedKeyword = capitalizeWords(focusKeyword);
    const pageTitle = `${capitalizedKeyword} | Huntington Beach, CA`;

    // Generate NEW slug from main keyword
    const newSlug = focusKeyword.replace(/\s+/g, '-').toLowerCase();
    const newServiceUrl = `${WP_CONFIG.url}/services/${newSlug}/`;

    // Prepare content with proper HTML structure (NO H1 - that's the title)
    let fullContent = content;
    
    // Remove any existing H1 from content if present (content is already HTML)
    fullContent = fullContent.replace(/<h1>.*?<\/h1>\s*/i, '');
    
    // Content is already HTML from GDoc, no conversion needed
    // Just ensure it starts with a tag
    if (!fullContent.trim().startsWith('<')) {
      fullContent = `<p>${fullContent}</p>`;
    }
    
    // Add backlink to Dr. Tran only
    fullContent += `\n\n<p><strong>About Dr. Tuan A. Tran</strong></p>\n<p>Dr. Tuan A. Tran is a board-certified plastic surgeon with extensive experience in ${capitalizedKeyword} and other cosmetic procedures. Schedule your consultation today at <a href="https://tranplastic.com/">Tran Plastic Surgery</a> or call (714) 839-8000.</p>`;

    // Insert support images with proper SEO
    if (supportImage1Url) {
      fullContent = fullContent.replace(
        '<h2>Who is a Good Candidate?</h2>',
        `<img src="${supportImage1Url}" alt="${capitalizedKeyword} procedure steps - ${capitalizedKeyword} in Huntington Beach CA" title="${capitalizedKeyword} procedure steps" />\n\n<h2>Who is a Good Candidate?</h2>`
      );
    }
    
    if (supportImage2Url) {
      fullContent = fullContent.replace(
        '<h2>Procedure in Detail</h2>',
        `<img src="${supportImage2Url}" alt="${capitalizedKeyword} results and recovery - ${capitalizedKeyword} Huntington Beach" title="${capitalizedKeyword} results and recovery" />\n\n<h2>Procedure in Detail</h2>`
      );
    }

    // Add FAQ Schema
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": `What is ${capitalizedKeyword}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `${capitalizedKeyword} is a cosmetic surgical procedure performed by Dr. Tuan A. Tran at our Huntington Beach, CA facility to improve appearance and contour.`
          }
        },
        {
          "@type": "Question",
          "name": `How long does ${capitalizedKeyword} take?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `The procedure typically takes 1-3 hours depending on the complexity and extent of correction needed.`
          }
        },
        {
          "@type": "Question",
          "name": `What is the recovery time for ${capitalizedKeyword}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `Most patients return to light activities within 1-2 weeks, with full recovery taking 4-6 weeks.`
          }
        },
        {
          "@type": "Question",
          "name": `Are the results of ${capitalizedKeyword} permanent?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `Results are long-lasting when you maintain a stable weight and healthy lifestyle.`
          }
        }
      ]
    };

    // Generate optimized meta description
    const optimizedMetaDesc = `Get ${capitalizedKeyword} in Huntington Beach, CA by Dr. Tuan A. Tran, board-certified plastic surgeon. Natural-looking results, personalized care. Book your free consultation today!`.substring(0, 160);

    // Update post/page with NEW slug (from main keyword)
    const postData = {
      title: pageTitle,
      content: fullContent,
      status: 'publish',
      slug: newSlug,
      meta: {
        _yoast_wpseo_title: `${capitalizedKeyword} Huntington Beach CA | Tran Plastic Surgery`,
        _yoast_wpseo_metadesc: optimizedMetaDesc,
        _yoast_wpseo_focuskw: focusKeyword,
        _yoast_wpseo_opengraph_title: `${capitalizedKeyword} Huntington Beach CA | Tran Plastic Surgery`,
        _yoast_wpseo_opengraph_description: optimizedMetaDesc,
        _yoast_wpseo_opengraph_image: featureImageUrl || '',
        _yoast_wpseo_schema: JSON.stringify(faqSchema)
      }
    };

    // Use correct endpoint based on whether it's a page or post
    const endpoint = postType;
    console.log(`[WP] Updating ${endpoint} with ID:`, postId);
    
    const response = await axios.post(
      `${WP_CONFIG.url}/wp-json/wp/v2/${endpoint}/${postId}`,
      postData,
      {
        auth: {
          username: WP_CONFIG.username,
          password: WP_CONFIG.password
        }
      }
    );

    // Upload and set featured image with SEO
    if (featureImageUrl) {
      try {
        const imageResponse = await axios.get(featureImageUrl, {
          responseType: 'arraybuffer',
          timeout: 60000
        });
        
        const safeKeyword = focusKeyword.replace(/\s+/g, '-').toLowerCase();
        const filename = `${safeKeyword}-feature.jpg`;
        
        const mediaResponse = await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media`,
          Buffer.from(imageResponse.data),
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            },
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Disposition': `attachment; filename="${filename}"`
            }
          }
        );

        const mediaId = mediaResponse.data.id;
        
        // Update media with alt text and description
        await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media/${mediaId}`,
          {
            alt_text: `${focusKeyword} - Featured image for ${focusKeyword} in Huntington Beach CA`,
            description: `${focusKeyword} procedure performed by Dr. Tuan A. Tran at Tran Plastic Surgery in Huntington Beach, CA.`,
            caption: `${focusKeyword} in Huntington Beach, CA`
          },
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            }
          }
        );

        // Set as featured image (use correct endpoint)
        await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/${endpoint}/${postId}`,
          { featured_media: mediaId },
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            }
          }
        );
      } catch (imageError) {
        console.error('Featured image error:', imageError.message);
      }
    }

    // Upload support images to WordPress media
    const uploadedSupportImages = [];
    
    // Support Image 1
    if (supportImage1Url) {
      try {
        console.log('[WP] Uploading support image 1...');
        const imageResponse = await axios.get(supportImage1Url, {
          responseType: 'arraybuffer',
          timeout: 60000
        });
        
        const safeKeyword = focusKeyword.replace(/\s+/g, '-').toLowerCase();
        const filename = `${safeKeyword}-support-1.jpg`;
        
        const mediaResponse = await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media`,
          Buffer.from(imageResponse.data),
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            },
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Disposition': `attachment; filename="${filename}"`
            }
          }
        );

        const mediaId = mediaResponse.data.id;
        
        // Update media with alt text and description
        await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media/${mediaId}`,
          {
            alt_text: `${capitalizedKeyword} procedure steps - ${capitalizedKeyword} in Huntington Beach CA`,
            description: `${capitalizedKeyword} procedure steps performed by Dr. Tuan A. Tran at Tran Plastic Surgery in Huntington Beach, CA.`,
            caption: `${capitalizedKeyword} procedure steps`
          },
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            }
          }
        );
        
        uploadedSupportImages.push({ id: mediaId, url: mediaResponse.data.source_url });
        console.log('[WP] Support image 1 uploaded:', mediaResponse.data.source_url);
      } catch (imageError) {
        console.error('Support image 1 error:', imageError.message);
      }
    }
    
    // Support Image 2
    if (supportImage2Url) {
      try {
        console.log('[WP] Uploading support image 2...');
        const imageResponse = await axios.get(supportImage2Url, {
          responseType: 'arraybuffer',
          timeout: 60000
        });
        
        const safeKeyword = focusKeyword.replace(/\s+/g, '-').toLowerCase();
        const filename = `${safeKeyword}-support-2.jpg`;
        
        const mediaResponse = await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media`,
          Buffer.from(imageResponse.data),
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            },
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Disposition': `attachment; filename="${filename}"`
            }
          }
        );

        const mediaId = mediaResponse.data.id;
        
        // Update media with alt text and description
        await axios.post(
          `${WP_CONFIG.url}/wp-json/wp/v2/media/${mediaId}`,
          {
            alt_text: `${capitalizedKeyword} results and recovery - ${capitalizedKeyword} Huntington Beach`,
            description: `${capitalizedKeyword} results and recovery at Tran Plastic Surgery in Huntington Beach, CA.`,
            caption: `${capitalizedKeyword} results and recovery`
          },
          {
            auth: {
              username: WP_CONFIG.username,
              password: WP_CONFIG.password
            }
          }
        );
        
        uploadedSupportImages.push({ id: mediaId, url: mediaResponse.data.source_url });
        console.log('[WP] Support image 2 uploaded:', mediaResponse.data.source_url);
      } catch (imageError) {
        console.error('Support image 2 error:', imageError.message);
      }
    }

    // Update spreadsheet with new URLs
    let spreadsheetUpdated = false;
    if (rowIndex && storedTokens) {
      try {
        googleService.setCredentialsFromTokens(storedTokens);
        const spreadsheetId = process.env.SPREADSHEET_ID;
        
        if (spreadsheetId) {
          // Update Service URL (column A) with new slug
          await googleService.updateSpreadsheet(spreadsheetId, `A${rowIndex}`, [[newServiceUrl]]);
          // Update WP Post URL (column E) with new slug
          await googleService.updateSpreadsheet(spreadsheetId, `E${rowIndex}`, [[newServiceUrl]]);
          // Update Status (column F) to Published
          await googleService.updateSpreadsheet(spreadsheetId, `F${rowIndex}`, [['Published']]);
          spreadsheetUpdated = true;
          console.log(`[WP] Spreadsheet updated for row ${rowIndex} with new URL: ${newServiceUrl}`);
        }
      } catch (sheetError) {
        console.error('[WP] Failed to update spreadsheet:', sheetError.message);
      }
    }

    res.json({
      success: true,
      postId: postId,
      url: newServiceUrl,
      oldUrl: serviceUrl,
      title: response.data.title.rendered,
      spreadsheetUpdated: spreadsheetUpdated,
      supportImagesUploaded: uploadedSupportImages.length,
      message: 'Service page updated successfully with new slug'
    });
  } catch (error) {
    console.error('Update service page error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test WordPress connection
app.get('/api/test-wp', async (req, res) => {
  try {
    if (!WP_CONFIG.url || !WP_CONFIG.username || !WP_CONFIG.password) {
      return res.status(400).json({ 
        connected: false, 
        error: 'WordPress not configured',
        config: {
          url: !!WP_CONFIG.url,
          username: !!WP_CONFIG.username,
          password: !!WP_CONFIG.password
        }
      });
    }

    // Test connection by fetching pages
    const response = await axios.get(
      `${WP_CONFIG.url}/wp-json/wp/v2/pages?per_page=1`,
      {
        auth: {
          username: WP_CONFIG.username,
          password: WP_CONFIG.password
        }
      }
    );

    res.json({
      connected: true,
      url: WP_CONFIG.url,
      pagesFound: response.data.length,
      samplePage: response.data[0] ? {
        id: response.data[0].id,
        title: response.data[0].title.rendered,
        slug: response.data[0].slug
      } : null
    });
  } catch (error) {
    res.status(500).json({
      connected: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    wpConfigured: !!(WP_CONFIG.url && WP_CONFIG.username && WP_CONFIG.password),
    version: '1.1.0' // Added to verify deployment
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

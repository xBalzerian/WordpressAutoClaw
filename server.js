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

// Generate content with Kimi + Create Google Doc + Update Sheet
app.post('/api/generate-content', async (req, res) => {
  try {
    const { keyword, serviceUrl, rowIndex, spreadsheetId, clusterKeywords } = req.body;
    
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
    
    // Generate optimized content
    const content = generateOptimizedContent(keyword, clusterKeywords);
    
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

// Generate optimized service content
function generateOptimizedContent(keyword, clusterKeywords = '') {
  const serviceName = keyword;
  const location = 'Huntington Beach, CA';
  const fullAddress = '20951 Brookhurst St Suite 107, Huntington Beach, CA 92646';
  
  // Parse cluster keywords for natural integration
  const clusterList = clusterKeywords.split(',').map(k => k.trim()).filter(k => k);
  const topClusters = clusterList.slice(0, 5); // Use top 5 cluster keywords
  
  // Short description - naturally include main keyword once
  const shortDescription = `${serviceName} in ${location} removes excess skin and fat to create a smoother, more toned appearance. Dr. Tuan A. Tran at Tran Plastic Surgery offers expert procedures with natural-looking results.`;
  
  // Build content with SEO optimization
  const fullContent = `${shortDescription}

## Overview

${serviceName} is a specialized cosmetic procedure designed to help patients achieve their desired aesthetic goals. At Tran Plastic Surgery in **${location}**, board-certified surgeon Dr. Tuan A. Tran provides expert care.

This treatment addresses specific concerns and enhances your overall appearance. Patients in **${location}** and surrounding areas choose this procedure for its transformative results and confidence-boosting effects.

## Who is a Good Candidate?

Ideal candidates are healthy adults with realistic expectations. During your consultation at our **${location}** facility, Dr. Tran will discuss your goals and medical history.

**You may be an ideal candidate if you:**
- Are in good overall health
- Have realistic expectations about results
- Are committed to following pre and post-operative instructions
- Do not smoke, or are willing to quit before and after surgery

## Procedure in Detail

The procedure is typically performed as an outpatient surgery. Dr. Tran customizes each treatment based on your unique anatomy and goals.

**The process involves:**

1. **Anesthesia** – General or local anesthesia with sedation ensures comfort
2. **Incision Placement** – Precise incisions based on your specific needs
3. **Tissue Manipulation** – Underlying tissues are reshaped for natural contours
4. **Closure** – Incisions are closed with sutures for optimal healing

## Recovery

Recovery varies by patient. Some discomfort is normal for several days following surgery.

**Common post-operative effects:**
- Mild pain and discomfort
- Swelling and bruising
- Tightness in treated areas
- Temporary numbness

Following Dr. Tran's post-operative instructions ensures optimal healing. Most patients return to light activities within 1-2 weeks, with full recovery in 4-6 weeks.

## Results

Once swelling subsides, you'll notice immediate improvements. Results are long-lasting with a stable weight and healthy lifestyle.

## Cost and Consultation

Pricing varies based on procedure complexity. Many insurance plans may cover this procedure depending on your case.

**Schedule your consultation:**
- 📞 Call: (714) 839-8000
- 🌐 Visit: www.tranplastic.com
- 📍 Location: ${fullAddress}

## Service Areas

While our primary office is in **Huntington Beach, CA**, we proudly serve patients throughout **Orange County** including Fountain Valley, Westminster, and surrounding communities.

---

## Frequently Asked Questions

**What is ${serviceName}?**
A cosmetic surgical procedure to improve body contour and appearance, performed by Dr. Tuan A. Tran at our Huntington Beach facility.

**How long does the procedure take?**
Typically 1-3 hours depending on complexity and extent of treatment.

**What is the recovery time?**
Most patients return to light activities within 1-2 weeks, with full recovery in 4-6 weeks.

**Are results permanent?**
Results are long-lasting when you maintain a stable weight and healthy lifestyle.

**Will there be visible scars?**
Incisions are strategically placed to minimize visibility. Scars fade over time.`;

  return {
    fullContent: fullContent,
    excerpt: `Learn about ${serviceName} at Tran Plastic Surgery in ${location}. Board-certified surgeon Dr. Tuan A. Tran provides expert care.`,
    metaTitle: `${serviceName} ${location} | Tran Plastic Surgery`,
    metaDescription: `${serviceName} in ${location} by Dr. Tuan A. Tran. Expert cosmetic surgery with natural results. Call (714) 839-8000 for free consultation.`,
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

// Generate images using Kie.ai
app.post('/api/generate-images-kie', async (req, res) => {
  try {
    const { keyword, rowIndex } = req.body;
    
    if (!KIE_CONFIG.API_KEY) {
      return res.status(400).json({ error: 'Kie API key not configured' });
    }
    
    const serviceName = keyword;
    const safeName = serviceName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    
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
    
    // Create 3 tasks
    for (const { prompt, type } of prompts) {
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
      message: `Created ${taskIds.length} image generation tasks. Images will be uploaded and spreadsheet updated when complete.`,
      tasks: taskIds
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
      
      // Check if all 3 images are done for this row
      await checkAndUpdateSpreadsheet(taskInfo.rowIndex, taskInfo.serviceName);
    }
    
    res.json({ received: true, processed: true });
  } catch (error) {
    console.error('[Kie Callback] Error:', error.message);
    res.json({ received: true, error: error.message });
  }
});

// Check if all images are done and update spreadsheet
async function checkAndUpdateSpreadsheet(rowIndex, serviceName) {
  try {
    // Find all completed tasks for this service
    const completedTasks = [];
    for (const [taskId, task] of pendingKieTasks) {
      if (task.serviceName === serviceName && task.status === 'completed' && task.rowIndex === rowIndex) {
        completedTasks.push(task);
      }
    }
    
    // Need all 3 types
    const hasFeature = completedTasks.find(t => t.type === 'feature');
    const hasSupport1 = completedTasks.find(t => t.type === 'support-1');
    const hasSupport2 = completedTasks.find(t => t.type === 'support-2');
    
    if (hasFeature && hasSupport1 && hasSupport2 && storedTokens) {
      console.log(`[Kie] All 3 images ready for ${serviceName}, updating spreadsheet...`);
      
      googleService.setCredentialsFromTokens(storedTokens);
      const spreadsheetId = process.env.SPREADSHEET_ID;
      
      if (spreadsheetId) {
        await googleService.updateSpreadsheet(spreadsheetId, `G${rowIndex}`, [[hasFeature.githubUrl]]);
        await googleService.updateSpreadsheet(spreadsheetId, `H${rowIndex}`, [[hasSupport1.githubUrl]]);
        await googleService.updateSpreadsheet(spreadsheetId, `I${rowIndex}`, [[hasSupport2.githubUrl]]);
        
        console.log(`[Kie] Spreadsheet updated for row ${rowIndex}`);
        
        // Clean up tasks
        for (const task of completedTasks) {
          pendingKieTasks.delete(task.taskId);
        }
      }
    }
  } catch (error) {
    console.error('[Kie] Check and update error:', error.message);
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
    
    // Remove any existing H1 from content if present
    fullContent = fullContent.replace(/^#\s+.*\n/, '');
    
    // Convert markdown to HTML for WordPress
    // Replace ## with h2, ### with h3, etc.
    fullContent = fullContent
      .replace(/##\s+(.*)/g, '<h2>$1</h2>')
      .replace(/###\s+(.*)/g, '<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>');
    
    // Wrap in paragraphs if not already
    if (!fullContent.startsWith('<')) {
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

    // Update post/page with NEW slug (from main keyword)
    const postData = {
      title: pageTitle,
      content: fullContent,
      status: 'publish',
      slug: newSlug,
      meta: {
        _yoast_wpseo_title: `${capitalizedKeyword} Huntington Beach CA | Tran Plastic Surgery`,
        _yoast_wpseo_metadesc: `${capitalizedKeyword} in Huntington Beach, CA by Dr. Tuan A. Tran. Expert cosmetic surgery with natural results. Call (714) 839-8000 for free consultation.`,
        _yoast_wpseo_focuskw: focusKeyword,
        _yoast_wpseo_opengraph_title: `${capitalizedKeyword} Huntington Beach CA | Tran Plastic Surgery`,
        _yoast_wpseo_opengraph_description: `${capitalizedKeyword} in Huntington Beach, CA by Dr. Tuan A. Tran. Expert cosmetic surgery with natural results.`,
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

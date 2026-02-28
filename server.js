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

// WordPress config (from env or defaults)
let WP_CONFIG = {
  url: process.env.WP_URL || '',
  username: process.env.WP_USERNAME || '',
  password: process.env.WP_APP_PASSWORD || ''
};

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
    const { keyword, serviceUrl, rowIndex, spreadsheetId } = req.body;
    
    // Check if authenticated
    if (!storedTokens) {
      return res.status(401).json({ 
        error: 'Not authenticated with Google. Please visit /auth/google first.' 
      });
    }
    
    // Set credentials
    googleService.setCredentialsFromTokens(storedTokens);
    
    // Fetch existing content from website
    let existingContent = '';
    if (serviceUrl) {
      try {
        const response = await axios.get(serviceUrl, { timeout: 10000 });
        existingContent = response.data;
      } catch (e) {
        console.log('Could not fetch existing content, generating fresh');
      }
    }
    
    // Generate optimized content
    const content = generateOptimizedContent(keyword, existingContent);
    
    // Create Google Doc via OAuth
    const docTitle = `${keyword} | Huntington Beach, CA`;
    const docResult = await googleService.createGoogleDoc(docTitle, content.fullContent);
    
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
  
  res.json({ success: true, message: 'WordPress config updated', url: cleanUrl });
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
function generateOptimizedContent(keyword, existingContent) {
  const serviceName = keyword;
  const location = 'Huntington Beach, CA';
  const fullAddress = '20951 Brookhurst St Suite 107, Huntington Beach, CA 92646';
  
  // Short description for after title
  const shortDescription = `${serviceName} in ${location} removes excess skin and fat to create a smoother, more toned appearance. Dr. Tuan A. Tran at Tran Plastic Surgery offers expert ${serviceName.toLowerCase()} procedures with natural-looking results.`;
  
  const fullContent = `# ${serviceName} | ${location}

${shortDescription}

## Overview

${serviceName}, also known as **${serviceName.toLowerCase().replace('surgery', 'procedure')}**, is a specialized cosmetic procedure designed to help patients achieve their desired aesthetic goals with natural-looking results. At Tran Plastic Surgery in **${location}**, board-certified surgeon Dr. Tuan A. Tran provides expert care for patients seeking ${serviceName.toLowerCase()}.

This treatment is designed to address specific concerns and enhance your overall appearance. For people seeking this procedure in **${location}**, it can be a transformative experience that boosts confidence and self-esteem. Having ${serviceName.toLowerCase()} performed by a board-certified surgeon ensures the highest standards of safety and care.

## Who is a Good Candidate?

A good candidate for ${serviceName.toLowerCase()} in **${location}** is a healthy adult with realistic expectations of what the procedure can help them achieve, along with an understanding of potential risks. Before proceeding with your surgery, your surgeon will go over an informed consent with you.

**You may be an ideal candidate if you:**
- Are in good overall health
- Have realistic expectations about results
- Are committed to following pre and post-operative instructions
- Do not smoke, or are willing to quit before and after surgery

Before your consultation for ${serviceName.toLowerCase()} at our **${location}** facility, be sure to discuss in detail with Dr. Tran about any medications that you take regularly. He will advise whether or not you will need to stop taking any of those medications before your surgery.

## Procedure in Detail

${serviceName} at Tran Plastic Surgery in **${location}** is typically performed as an outpatient procedure. The procedure time varies depending on the complexity and your specific needs.

**The ${serviceName.toLowerCase()} procedure involves:**

1. **Anesthesia** – General anesthesia or local anesthesia with sedation is administered to ensure your comfort throughout the surgery.

2. **Incision Placement** – Dr. Tran will make precise incisions based on the specific technique required for your case and the areas being treated.

3. **Tissue Manipulation** – The underlying tissues will be carefully manipulated to achieve the desired result and create natural-looking contours.

4. **Closure** – The incisions will be closed with sutures, and dressings are applied to protect the surgical sites.

The procedure is customized to each patient's unique anatomy and goals. Dr. Tran will discuss the specific approach for your ${serviceName.toLowerCase()} during your consultation in **${location}**.

## Recovery

The healing time after ${serviceName.toLowerCase()} varies for each patient. Some pain and discomfort are expected after the procedure for several days following the surgery.

**Post-operative side effects include:**

- Slight pain and discomfort
- Swelling and bruising
- Tightness in the treated area
- Temporary numbness

Icing and taking medications as prescribed by Dr. Tran will help minimize these side effects. For your most optimal recovery from ${serviceName.toLowerCase()}, please refer to the post-operative instructions given to you prior to the surgery.

As always, you are more than welcome to reach out to our **${location}** office for any questions that arise during your recovery period. Generally, it is recommended that you rest for at least a few days and avoid vigorous activity. You will then follow-up with Dr. Tran after 5-7 days from your surgery for your post-op appointment.

## Results

Once the swelling has subsided, you should be able to immediately notice the results of ${serviceName.toLowerCase()}. The improvement should look natural and enhance your overall appearance. Any incision scars should fade over time, while you may opt to apply a silicone scar sheet to boost the healing outcome.

Results from ${serviceName.toLowerCase()} are long-lasting when you maintain a stable weight and healthy lifestyle. Dr. Tran will provide guidance on maintaining your results during your follow-up visits at our **${location}** location.

## Cost and Consultation

The cost of ${serviceName.toLowerCase()} in **${location}** varies depending on the complexity of the procedure and your specific needs. Many major medical insurances in California may cover ${serviceName.toLowerCase()} depending on your specific case.

**Schedule your free consultation for ${serviceName.toLowerCase()}:**
- 📞 Call: (714) 839-8000
- 🌐 Visit: www.tranplastic.com
- 📍 Location: ${fullAddress}

Dr. Tran and our team are ready to help you achieve your aesthetic goals with personalized care and expertise.

---

## Frequently Asked Questions

**Q: What is ${serviceName.toLowerCase()}?**
A: ${serviceName} is a cosmetic surgical procedure designed to improve the appearance and contour of specific areas. It is performed by board-certified surgeon Dr. Tuan A. Tran at our ${location} facility.

**Q: How long does ${serviceName.toLowerCase()} take?**
A: The procedure typically takes 1-3 hours depending on the complexity and extent of correction needed.

**Q: What is the recovery time for ${serviceName.toLowerCase()}?**
A: Most patients return to light activities within 1-2 weeks, with full recovery taking 4-6 weeks.

**Q: Are the results of ${serviceName.toLowerCase()} permanent?**
A: Results are long-lasting when you maintain a stable weight and healthy lifestyle.

**Q: Will there be visible scars after ${serviceName.toLowerCase()}?**
A: Incisions are strategically placed to minimize visibility. Scars fade over time and can be further improved with scar treatments.`;

  return {
    fullContent: fullContent,
    excerpt: `Learn about ${serviceName} at Tran Plastic Surgery in ${location}. Board-certified surgeon Dr. Tuan A. Tran provides expert care.`,
    metaTitle: `${serviceName} ${location} | Tran Plastic Surgery`,
    metaDescription: `${serviceName} in ${location} by Dr. Tuan A. Tran. Expert cosmetic surgery with natural results. Call (714) 839-8000 for free consultation.`
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    wpConfigured: !!(WP_CONFIG.url && WP_CONFIG.username && WP_CONFIG.password)
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

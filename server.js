const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hardcoded sheet URL
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRdkdttxEJQt-kWPgBBsehHymf8inl5wO0N_NoVqS5lNKhavDgqDVgni7HSfA-CE8d8VmjqHw5MMBuk/pub?output=csv';

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

// Detect column types from headers
function detectColumns(headers) {
  const detected = {
    topic: null,
    status: null,
    content: null,
    wpUrl: null,
    imageUrl: null
  };

  headers.forEach(header => {
    const lower = header.toLowerCase();
    
    // Topic/Main Keyword
    if (!detected.topic && (
      lower.includes('keyword') || 
      lower.includes('topic') || 
      lower.includes('title') ||
      lower.includes('main')
    )) {
      detected.topic = header;
    }
    
    // Status
    if (!detected.status && lower.includes('status')) {
      detected.status = header;
    }
    
    // Content
    if (!detected.content && (
      lower.includes('content') || 
      lower.includes('gdocs') || 
      lower.includes('doc')
    )) {
      detected.content = header;
    }
    
    // WP URL
    if (!detected.wpUrl && (
      lower.includes('wp') || 
      lower.includes('post') || 
      lower.includes('url')
    ) && !lower.includes('service')) {
      detected.wpUrl = header;
    }
    
    // Image
    if (!detected.imageUrl && (
      lower.includes('image') || 
      lower.includes('feature')
    )) {
      detected.imageUrl = header;
    }
  });

  // Fallback - use first column as topic if nothing detected
  if (!detected.topic && headers.length > 0) {
    detected.topic = headers[0];
  }

  return detected;
}

// Get sheet data
app.get('/api/sheet', async (req, res) => {
  try {
    console.log('Fetching sheet...');
    const response = await axios.get(SHEET_URL, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const parsed = parseCSV(response.data);
    const columns = detectColumns(parsed.headers);
    
    console.log('Headers:', parsed.headers);
    console.log('Detected columns:', columns);
    console.log(`Loaded ${parsed.data.length} rows`);
    
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

// Generate content
app.post('/api/generate-content', async (req, res) => {
  const { topic } = req.body;
  res.json({
    success: true,
    title: `${topic}: A Comprehensive Guide`,
    content: `# ${topic}: A Comprehensive Guide\n\n## Introduction\n\nThis guide covers everything about ${topic}.\n\n## Key Points\n\n- Important point 1\n- Important point 2\n- Important point 3\n\n## Conclusion\n\nIn conclusion, ${topic} is essential.`,
    excerpt: `Learn everything about ${topic} in this comprehensive guide.`
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/**
 * Google Sheets Service
 * Uses public CSV export for reading, Google Apps Script for writing
 */

class SheetsService {
  constructor(sheetUrl) {
    this.sheetUrl = sheetUrl;
    this.spreadsheetId = this.extractSpreadsheetId(sheetUrl);
  }

  extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Read sheet data via backend API
   */
  async readSheet(sheetName = 'Sheet1') {
    try {
      // Call our backend API instead of direct Google fetch
      const response = await fetch('/api/sheet');
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch sheet');
      }
      
      return await response.json();
    } catch (error) {
      console.error('Read sheet error:', error);
      throw error;
    }
  }

  /**
   * Parse CSV text into structured data
   */
  parseCSV(csvText) {
    const lines = csvText.split('\n');
    if (lines.length === 0) return { headers: [], data: [] };

    // Parse headers
    const headers = this.parseCSVLine(lines[0]);
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = this.parseCSVLine(lines[i]);
      const row = { _rowIndex: i + 1 }; // 1-based row number
      
      headers.forEach((header, index) => {
        const key = this.sanitizeHeader(header);
        row[key] = values[index] || '';
      });
      
      data.push(row);
    }

    return { headers, data };
  }

  /**
   * Parse a single CSV line (handles quoted values)
   */
  parseCSVLine(line) {
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
            i++; // Skip next quote
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
  }

  /**
   * Sanitize header name for use as object key
   */
  sanitizeHeader(header) {
    return header
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Update a cell in the spreadsheet
   * Note: This requires a backend proxy or Google Apps Script
   * For now, we'll use a simple approach with a backend endpoint
   */
  async updateCell(row, column, value) {
    // This will be implemented via backend proxy
    // For browser-only, we'll need a different approach
    console.log(`Update cell: Row ${row}, Col ${column}, Value: ${value}`);
    
    // Placeholder - actual implementation needs backend
    return { success: true };
  }

  /**
   * Get column index by header name
   */
  getColumnIndex(headers, columnName) {
    const sanitized = this.sanitizeHeader(columnName);
    return headers.findIndex(h => this.sanitizeHeader(h) === sanitized);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsService;
}

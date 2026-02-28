const { google } = require('googleapis');

// Get service account from env var (base64 encoded JSON)
let SERVICE_ACCOUNT = {};
try {
  const base64Key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  if (base64Key) {
    const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
    SERVICE_ACCOUNT = JSON.parse(decoded);
  }
} catch (e) {
  console.error('Failed to decode service account key:', e.message);
}

class GoogleService {
  constructor() {
    this.auth = new google.auth.GoogleAuth({
      credentials: SERVICE_ACCOUNT,
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });
    
    this.docs = google.docs({ version: 'v1', auth: this.auth });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async createGoogleDoc(title, content) {
    try {
      // Create document
      const createResponse = await this.docs.documents.create({
        requestBody: {
          title: title
        }
      });

      const documentId = createResponse.data.documentId;

      // Insert content
      await this.docs.documents.batchUpdate({
        documentId: documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: {
                  index: 1
                },
                text: content
              }
            }
          ]
        }
      });

      // Get document URL
      const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

      return {
        success: true,
        docId: documentId,
        docUrl: docUrl,
        message: 'Google Doc created successfully'
      };
    } catch (error) {
      console.error('Google Docs error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateSpreadsheet(spreadsheetId, range, values) {
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        requestBody: {
          values: values
        }
      });

      return {
        success: true,
        updatedRange: response.data.updatedRange,
        message: 'Spreadsheet updated successfully'
      };
    } catch (error) {
      console.error('Google Sheets error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = GoogleService;

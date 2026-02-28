const { google } = require('googleapis');

// Get service account from env var (raw JSON)
let SERVICE_ACCOUNT = {};
try {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  console.log('GOOGLE_SERVICE_ACCOUNT_JSON length:', rawJson.length);
  
  if (rawJson) {
    SERVICE_ACCOUNT = JSON.parse(rawJson);
    console.log('Service account loaded successfully');
    console.log('client_email:', SERVICE_ACCOUNT.client_email);
  } else {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is empty');
  }
} catch (e) {
  console.error('Failed to parse service account JSON:', e.message);
}

class GoogleService {
  constructor() {
    // Use domain-wide delegation with user impersonation
    this.auth = new google.auth.GoogleAuth({
      credentials: SERVICE_ACCOUNT,
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ],
      // Impersonate the user who owns the spreadsheet
      clientOptions: {
        subject: process.env.GOOGLE_USER_EMAIL || 'balzgaming77@gmail.com'
      }
    });
    
    this.docs = google.docs({ version: 'v1', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async createGoogleDoc(title, content) {
    try {
      // Create document (without parents - docs API doesn't support it)
      const createResponse = await this.docs.documents.create({
        requestBody: {
          title: title
        }
      });

      const documentId = createResponse.data.documentId;

      // If folder ID provided, move doc to folder using Drive API
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
      if (folderId) {
        try {
          await this.drive.files.update({
            fileId: documentId,
            addParents: folderId,
            fields: 'id, parents'
          });
        } catch (driveError) {
          console.log('Could not move to folder:', driveError.message);
          // Continue anyway - doc is created
        }
      }

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
      console.error('Full error:', error);
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

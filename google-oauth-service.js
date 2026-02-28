const { google } = require('googleapis');

// OAuth2 client setup
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://wordpress-claw.onrender.com/auth/google/callback';

class GoogleOAuthService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );
    
    this.docs = google.docs({ version: 'v1', auth: this.oauth2Client });
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
  }

  getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async setCredentials(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  setCredentialsFromTokens(tokens) {
    this.oauth2Client.setCredentials(tokens);
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

      // Share with your email immediately
      try {
        await this.drive.permissions.create({
          fileId: documentId,
          requestBody: {
            role: 'writer',
            type: 'user',
            emailAddress: 'balzgaming77@gmail.com'
          }
        });
        console.log('Document shared with balzgaming77@gmail.com');
      } catch (shareError) {
        console.log('Could not share document:', shareError.message);
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

module.exports = GoogleOAuthService;

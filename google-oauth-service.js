const { google } = require('googleapis');

// OAuth2 client setup
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://wordpress-claw.onrender.com/auth/google/callback';

class GoogleOAuthService {
  constructor() {
    this.oauth2Client = null;
    this.serviceAccountAuth = null;
    this.docs = null;
    this.drive = null;
    this.sheets = null;
    
    // Check if Service Account key is available
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        // Create JWT client for Service Account
        this.serviceAccountAuth = new google.auth.JWT(
          serviceAccountKey.client_email,
          null,
          serviceAccountKey.private_key,
          [
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets'
          ]
        );
        
        // Initialize APIs with Service Account auth
        this.docs = google.docs({ version: 'v1', auth: this.serviceAccountAuth });
        this.drive = google.drive({ version: 'v3', auth: this.serviceAccountAuth });
        this.sheets = google.sheets({ version: 'v4', auth: this.serviceAccountAuth });
        
        console.log('Service Account authentication configured');
      } catch (e) {
        console.error('Failed to parse Service Account key:', e.message);
      }
    }
    
    // Setup OAuth2 client as fallback
    if (!this.serviceAccountAuth && CLIENT_ID && CLIENT_SECRET) {
      this.oauth2Client = new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        REDIRECT_URI
      );
      
      // Initialize APIs with OAuth2
      this.docs = google.docs({ version: 'v1', auth: this.oauth2Client });
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    }
  }
  
  hasServiceAccount() {
    return this.serviceAccountAuth !== null;
  }
  
  hasOAuth() {
    return this.oauth2Client !== null;
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
      console.log('Created document:', documentId);

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

      // Get document to find end index
      const doc = await this.docs.documents.get({ documentId });
      const endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex || 2;
      console.log('Document end index:', endIndex);

      // Insert content at the end
      if (content && content.length > 0) {
        await this.docs.documents.batchUpdate({
          documentId: documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: {
                    index: endIndex - 1
                  },
                  text: content
                }
              }
            ]
          }
        });
        console.log('Content inserted successfully');
      }

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

  async updateGoogleDoc(documentId, content) {
    try {
      // Clear existing content and insert new content
      const doc = await this.docs.documents.get({ documentId });
      const endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex || 2;
      
      // Delete existing content (except first character)
      if (endIndex > 2) {
        await this.docs.documents.batchUpdate({
          documentId: documentId,
          requestBody: {
            requests: [
              {
                deleteContentRange: {
                  range: {
                    startIndex: 1,
                    endIndex: endIndex - 1
                  }
                }
              }
            ]
          }
        });
      }
      
      // Insert new content
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
      
      return {
        success: true,
        message: 'Document updated successfully'
      };
    } catch (error) {
      console.error('Update Google Doc error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSpreadsheetData(spreadsheetId, range) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: range
      });
      
      return {
        success: true,
        values: response.data.values
      };
    } catch (error) {
      console.error('Get Spreadsheet error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getGoogleDocContent(docUrl) {
    try {
      // Extract document ID from URL
      const match = docUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return { success: false, error: 'Invalid Google Doc URL' };
      }
      
      const documentId = match[1];
      console.log('Fetching document:', documentId);

      // Get document content
      const doc = await this.docs.documents.get({ documentId });
      
      // Extract text content
      let content = '';
      const body = doc.data.body;
      
      if (body && body.content) {
        for (const element of body.content) {
          if (element.paragraph) {
            for (const paraElement of element.paragraph.elements) {
              if (paraElement.textRun && paraElement.textRun.content) {
                content += paraElement.textRun.content;
              }
            }
          }
        }
      }

      return {
        success: true,
        title: doc.data.title,
        content: content,
        docId: documentId
      };
    } catch (error) {
      console.error('Get Google Doc error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = GoogleOAuthService;

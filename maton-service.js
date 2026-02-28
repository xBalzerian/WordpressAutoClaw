const axios = require('axios');

const MATON_API_KEY = process.env.MATON_API_KEY || '';
const MATON_CONNECTION_ID = process.env.MATON_CONNECTION_ID || '9e0f0cd7-3fda-45cc-9034-cc9f4e9aa1bc';
const MATON_BASE_URL = 'https://api.maton.ai/v1';

class MatonService {
  constructor() {
    this.apiKey = MATON_API_KEY;
    this.connectionId = MATON_CONNECTION_ID;
    this.baseURL = MATON_BASE_URL;
  }

  async createGoogleDoc(title, content, connectionId = null) {
    const connId = connectionId || this.connectionId;
    try {
      const response = await axios.post(
        `${this.baseURL}/connections/${connId}/docs/create`,
        {
          title: title,
          content: content
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      return {
        success: true,
        docId: response.data.documentId || response.data.id,
        docUrl: response.data.webViewLink || response.data.url,
        message: 'Google Doc created successfully'
      };
    } catch (error) {
      console.error('Maton create doc error:', error.message);
      console.error('Error details:', error.response?.data);
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data?.error || error.message
      };
    }
  }

  async updateSpreadsheet(spreadsheetId, range, values, connectionId = null) {
    const connId = connectionId || this.connectionId;
    try {
      const response = await axios.post(
        `${this.baseURL}/connections/${connId}/sheets/values`,
        {
          spreadsheetId: spreadsheetId,
          range: range,
          values: values
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return {
        success: true,
        updatedRange: response.data.updatedRange,
        message: 'Spreadsheet updated successfully'
      };
    } catch (error) {
      console.error('Maton update sheet error:', error.message);
      console.error('Error details:', error.response?.data);
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data?.error || error.message
      };
    }
  }
}

module.exports = MatonService;

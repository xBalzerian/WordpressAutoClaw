const axios = require('axios');

const MATON_API_KEY = process.env.MATON_API_KEY || 'CYndigcgcHitD2CYT68LmrrSi60GAAxvgJwNLJtK-hDVy-ABfe1RJPGJOsx-2Ak7gL-JPuA2DvsyLAJuF8CMyBOmlSdCAB2zVVj1zZaLJA';
const MATON_BASE_URL = 'https://api.maton.ai/v1';

class MatonService {
  constructor() {
    this.apiKey = MATON_API_KEY;
    this.baseURL = MATON_BASE_URL;
  }

  async createGoogleDoc(title, content, connectionId = '9e0f0cd7-3fda-45cc-9034-cc9f4e9aa1bc') {
    try {
      const response = await axios.post(
        `${this.baseURL}/connections/${connectionId}/docs/create`,
        {
          title: title,
          content: content
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
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

  async updateSpreadsheet(spreadsheetId, range, values, connectionId = '9e0f0cd7-3fda-45cc-9034-cc9f4e9aa1bc') {
    try {
      const response = await axios.post(
        `${this.baseURL}/connections/${connectionId}/sheets/values`,
        {
          spreadsheetId: spreadsheetId,
          range: range,
          values: values
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
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

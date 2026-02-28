const axios = require('axios');

const MATON_API_KEY = process.env.MATON_API_KEY || 'CYndigcgcHitD2CYT68LmrrSi60GAAxvgJwNLJtK-hDVy-ABfe1RJPGJOsx-2Ak7gL-JPuA2DvsyLAJuF8CMyBOmlSdCAB2zVVj1zZaLJA';
const MATON_BASE_URL = 'https://api.maton.ai/v1';

class MatonService {
  constructor() {
    this.apiKey = MATON_API_KEY;
    this.baseURL = MATON_BASE_URL;
  }

  async createGoogleDoc(title, content) {
    try {
      const response = await axios.post(
        `${this.baseURL}/google/docs/create`,
        {
          title: title,
          content: content,
          format: 'markdown'
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
        docId: response.data.docId,
        docUrl: response.data.url,
        message: 'Google Doc created successfully'
      };
    } catch (error) {
      console.error('Maton create doc error:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async updateSpreadsheet(spreadsheetId, range, values) {
    try {
      const response = await axios.post(
        `${this.baseURL}/google/sheets/update`,
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
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async generateContent(prompt) {
    try {
      const response = await axios.post(
        `${this.baseURL}/ai/generate`,
        {
          prompt: prompt,
          model: 'gpt-4',
          max_tokens: 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      return {
        success: true,
        content: response.data.content,
        message: 'Content generated successfully'
      };
    } catch (error) {
      console.error('Maton generate error:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

module.exports = MatonService;

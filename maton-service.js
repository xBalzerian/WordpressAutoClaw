const axios = require('axios');

// Hardcoded for testing - personal tool
const MATON_API_KEY = 'qb0DPBxhmOTJFttKYjcu25ItSl9IaYNW0ek8Szx5AnjUmxx8coc4RJ-2FKbtpoR-aDslAyJoWCjsPhUfiZ_m8UzZk2U9Ysv0C84';
const MATON_CONNECTION_ID = '239c2eb4-3f4f-468b-ad5b-1e838f534659';
const MATON_BASE_URL = 'https://api.maton.ai/v1';

console.log('Maton Service initialized (hardcoded):');
console.log('API Key exists:', !!MATON_API_KEY);
console.log('Connection ID:', MATON_CONNECTION_ID);

class MatonService {
  constructor() {
    this.apiKey = MATON_API_KEY;
    this.connectionId = MATON_CONNECTION_ID;
    this.baseURL = MATON_BASE_URL;
  }

  async createGoogleDoc(title, content, connectionId = null) {
    const connId = connectionId || this.connectionId;
    
    console.log('Creating Google Doc...');
    console.log('Connection ID:', connId);
    console.log('API Key length:', this.apiKey.length);
    
    if (!this.apiKey) {
      return { success: false, error: 'MATON_API_KEY not set' };
    }
    if (!connId) {
      return { success: false, error: 'MATON_CONNECTION_ID not set' };
    }
    
    try {
      // Try with api_key as query parameter
      const url = `${this.baseURL}/connections/${connId}/docs/create?api_key=${this.apiKey}`;
      console.log('Request URL:', url);
      
      const response = await axios.post(
        url,
        {
          title: title,
          content: content
        },
        {
          headers: {
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
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
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

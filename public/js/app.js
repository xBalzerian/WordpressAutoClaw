/**
 * Main Application Logic
 */

class WordPressClawApp {
  constructor() {
    this.sheetsService = new SheetsService(CONFIG.SHEET_URL);
    this.contentService = new ContentService(CONFIG);
    this.imageService = new ImageService(CONFIG);
    this.wpService = new WordPressService(CONFIG);
    
    this.articles = [];
    this.currentRow = null;
    this.generatedImageUrl = null;
    this.savedSheets = [];
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadConfig().then(() => {
      this.loadSheetInfo();
      this.loadSavedSheets();
      this.loadData();
    });
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const serverConfig = await response.json();
        Object.assign(CONFIG, serverConfig);
        console.log('Config loaded:', CONFIG);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  bindEvents() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.loadData();
    });

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
      this.openSettingsModal();
    });

    // Connect Google button
    const connectGoogleBtn = document.getElementById('connectGoogleBtn');
    if (connectGoogleBtn) {
      connectGoogleBtn.addEventListener('click', () => {
        window.location.href = '/auth/google';
      });
    }

    // Select sheet button
    const selectSheetBtn = document.getElementById('selectSheetBtn');
    if (selectSheetBtn) {
      selectSheetBtn.addEventListener('click', () => {
        this.openGoogleSheetsModal();
      });
    }

    // Disconnect Google button
    const disconnectGoogleBtn = document.getElementById('disconnectGoogleBtn');
    if (disconnectGoogleBtn) {
      disconnectGoogleBtn.addEventListener('click', () => {
        this.disconnectGoogle();
      });
    }

    // Process all button
    document.getElementById('processAllBtn').addEventListener('click', () => {
      this.processAllPending();
    });

    // Retry button
    document.getElementById('retryBtn').addEventListener('click', () => {
      this.loadData();
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.add('hidden');
      });
    });

    // Content modal save
    document.getElementById('saveContentBtn').addEventListener('click', () => {
      this.saveContent();
    });

    // Image modal generate
    document.getElementById('generateImageBtn').addEventListener('click', () => {
      this.generateImage();
    });

    // Image modal save
    document.getElementById('saveImageBtn').addEventListener('click', () => {
      this.saveImage();
    });

    // Settings save
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      this.saveSettings();
    });

    // Sheet manager events
    document.getElementById('addSheetBtn').addEventListener('click', () => {
      this.addNewSheet();
    });
  }

  async loadData() {
    this.showLoading(true);
    this.showError(false);

    try {
      console.log('Loading data from API...');
      const result = await this.sheetsService.readSheet();
      console.log('Got data:', result);
      
      if (!result.data || result.data.length === 0) {
        console.log('No data found in sheet');
        this.articles = [];
        this.renderTable();
        this.updateStats();
        this.showLoading(false);
        return;
      }
      
      this.articles = result.data.map((row, index) => ({
        ...row,
        _originalIndex: index
      }));
      
      this.renderTable();
      this.updateStats();
      this.updateLastUpdated();
      
      this.showLoading(false);
    } catch (error) {
      console.error('Load error:', error);
      this.showLoading(false);
      this.showError(true, error.message || 'Failed to load spreadsheet');
    }
  }

  renderTable() {
    const tbody = document.getElementById('articlesBody');
    const emptyState = document.getElementById('emptyState');
    
    console.log('Rendering table with', this.articles.length, 'articles');
    
    if (this.articles.length === 0) {
      tbody.innerHTML = '';
      emptyState.classList.remove('hidden');
      document.getElementById('articlesTable').classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    document.getElementById('articlesTable').classList.remove('hidden');
    
    tbody.innerHTML = this.articles.map((article, index) => {
      const status = article.status || 'PENDING';
      const topic = article.topic || 'Untitled';
      
      return `
        <tr data-index="${index}">
          <td>${this.renderStatusBadge(status)}</td>
          <td class="topic-cell">
            <div class="topic-title">${this.escapeHtml(topic)}</div>
            ${article.notes ? `<div class="topic-meta">${this.escapeHtml(article.notes)}</div>` : ''}
          </td>
          <td>${this.renderContentAction(status, index)}</td>
          <td>${this.renderImageAction(status, index)}</td>
          <td>${this.renderMainAction(status, index)}</td>
        </tr>
      `;
    }).join('');

    // Bind action buttons
    this.bindActionButtons();
  }

  renderStatusBadge(status) {
    const statusMap = {
      'PENDING': { class: 'status-pending', icon: '⏳', label: 'Pending' },
      'CONTENT_DONE': { class: 'status-content', icon: '📝', label: 'Content Ready' },
      'IMAGE_DONE': { class: 'status-image', icon: '🖼️', label: 'Image Ready' },
      'PUBLISHED': { class: 'status-published', icon: '✅', label: 'Published' },
      'ERROR': { class: 'status-error', icon: '❌', label: 'Error' }
    };

    const s = statusMap[status] || statusMap['PENDING'];
    return `<span class="status-badge ${s.class}">${s.icon} ${s.label}</span>`;
  }

  renderContentAction(status, index) {
    if (status === 'PENDING' || status === 'ERROR') {
      return `<button class="btn btn-primary btn-small" data-action="write" data-index="${index}">✍️ Write</button>`;
    }
    
    const article = this.articles[index];
    const hasContent = article.content && article.content.length > 50;
    
    if (hasContent) {
      return `<button class="btn btn-secondary btn-small" data-action="edit" data-index="${index}">📝 Edit</button>`;
    }
    
    return '-';
  }

  renderImageAction(status, index) {
    if (status === 'CONTENT_DONE') {
      return `<button class="btn btn-primary btn-small" data-action="generate-image" data-index="${index}">🎨 Generate</button>`;
    }
    
    if (status === 'IMAGE_DONE' || status === 'PUBLISHED') {
      const article = this.articles[index];
      if (article.image_url) {
        return `<button class="btn btn-secondary btn-small" data-action="regen-image" data-index="${index}">🔄 Regen</button>`;
      }
    }
    
    return '-';
  }

  renderMainAction(status, index) {
    const article = this.articles[index];
    
    if (status === 'IMAGE_DONE') {
      return `<button class="btn btn-success btn-small" data-action="publish" data-index="${index}">🚀 Publish</button>`;
    }
    
    if (status === 'PUBLISHED' && article.wp_url) {
      return `<a href="${article.wp_url}" target="_blank" class="btn btn-secondary btn-small">🔗 View</a>`;
    }
    
    return '-';
  }

  bindActionButtons() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const index = parseInt(e.target.dataset.index);
        this.handleAction(action, index);
      });
    });
  }

  async handleAction(action, index) {
    this.currentRow = index;
    const article = this.articles[index];
    
    switch (action) {
      case 'write':
        await this.writeContent(index);
        break;
      case 'edit':
        this.openContentModal(index);
        break;
      case 'generate-image':
        this.openImageModal(index);
        break;
      case 'regen-image':
        this.openImageModal(index);
        break;
      case 'publish':
        await this.publishArticle(index);
        break;
    }
  }

  async writeContent(index) {
    const article = this.articles[index];
    const topic = article.topic;
    
    this.showToast(`Generating content for "${topic}"...`, 'info');
    
    const result = await this.contentService.generateContent(topic, CONFIG.CONTENT);
    
    if (result.success) {
      // Update article data
      this.articles[index].content = result.content;
      this.articles[index].title = result.title;
      this.articles[index].excerpt = result.excerpt;
      this.articles[index].tags = result.tags;
      this.articles[index].status = 'CONTENT_DONE';
      
      this.showToast('Content generated successfully!', 'success');
      this.renderTable();
      this.updateStats();
    } else {
      this.showToast(`Error: ${result.error}`, 'error');
    }
  }

  openContentModal(index) {
    const article = this.articles[index];
    document.getElementById('contentTitle').value = article.title || '';
    document.getElementById('contentBody').value = article.content || '';
    document.getElementById('contentModal').classList.remove('hidden');
  }

  saveContent() {
    const title = document.getElementById('contentTitle').value;
    const content = document.getElementById('contentBody').value;
    
    this.articles[this.currentRow].title = title;
    this.articles[this.currentRow].content = content;
    
    document.getElementById('contentModal').classList.add('hidden');
    this.showToast('Content saved', 'success');
  }

  openImageModal(index) {
    const article = this.articles[index];
    const defaultPrompt = this.imageService.enhancePrompt('', article.title || article.topic);
    document.getElementById('imagePrompt').value = defaultPrompt;
    document.getElementById('imagePreview').classList.add('hidden');
    document.getElementById('saveImageBtn').classList.add('hidden');
    document.getElementById('generateImageBtn').classList.remove('hidden');
    document.getElementById('imageModal').classList.remove('hidden');
  }

  async generateImage() {
    const prompt = document.getElementById('imagePrompt').value;
    
    document.getElementById('imageLoading').classList.remove('hidden');
    document.getElementById('generateImageBtn').disabled = true;
    
    const result = await this.imageService.generateImage(prompt);
    
    document.getElementById('imageLoading').classList.add('hidden');
    document.getElementById('generateImageBtn').disabled = false;
    
    if (result.success) {
      this.generatedImageUrl = result.imageUrl;
      document.getElementById('generatedImage').src = result.imageUrl;
      document.getElementById('imagePreview').classList.remove('hidden');
      document.getElementById('saveImageBtn').classList.remove('hidden');
      document.getElementById('generateImageBtn').classList.add('hidden');
    } else {
      this.showToast(`Image generation failed: ${result.error}`, 'error');
    }
  }

  saveImage() {
    this.articles[this.currentRow].image_url = this.generatedImageUrl;
    this.articles[this.currentRow].status = 'IMAGE_DONE';
    
    document.getElementById('imageModal').classList.add('hidden');
    this.showToast('Image saved', 'success');
    this.renderTable();
    this.updateStats();
  }

  async publishArticle(index) {
    const article = this.articles[index];
    
    this.showToast('Publishing to WordPress...', 'info');
    
    const result = await this.wpService.publishArticle({
      title: article.title,
      content: article.content,
      excerpt: article.excerpt,
      tags: article.tags,
      featuredImageUrl: article.image_url
    });
    
    if (result.success) {
      this.articles[index].wp_url = result.url;
      this.articles[index].status = 'PUBLISHED';
      this.showToast(`Published! ${result.url}`, 'success');
      this.renderTable();
      this.updateStats();
    } else {
      this.showToast(`Publish failed: ${result.error}`, 'error');
    }
  }

  async processAllPending() {
    const pending = this.articles.filter(a => a.status === 'PENDING' || !a.status);
    
    if (pending.length === 0) {
      this.showToast('No pending articles', 'info');
      return;
    }
    
    this.showToast(`Processing ${pending.length} articles...`, 'info');
    
    for (const article of pending) {
      const index = this.articles.indexOf(article);
      await this.writeContent(index);
    }
  }

  updateStats() {
    const counts = {
      PENDING: 0,
      CONTENT_DONE: 0,
      IMAGE_DONE: 0,
      PUBLISHED: 0
    };
    
    this.articles.forEach(a => {
      const status = a.status || 'PENDING';
      counts[status] = (counts[status] || 0) + 1;
    });
    
    document.getElementById('pendingCount').textContent = counts.PENDING;
    document.getElementById('contentCount').textContent = counts.CONTENT_DONE;
    document.getElementById('imageCount').textContent = counts.IMAGE_DONE;
    document.getElementById('publishedCount').textContent = counts.PUBLISHED;
  }

  updateLastUpdated() {
    const now = new Date();
    document.getElementById('lastUpdated').textContent = 
      `Updated ${now.toLocaleTimeString()}`;
  }

  openSettingsModal() {
    document.getElementById('wpUrl').value = CONFIG.WP_URL || '';
    document.getElementById('wpUsername').value = CONFIG.WP_USERNAME || '';
    document.getElementById('wpPassword').value = CONFIG.WP_APP_PASSWORD || '';
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  saveSettings() {
    CONFIG.WP_URL = document.getElementById('wpUrl').value;
    CONFIG.WP_USERNAME = document.getElementById('wpUsername').value;
    CONFIG.WP_APP_PASSWORD = document.getElementById('wpPassword').value;
    
    // Reinitialize WordPress service
    this.wpService = new WordPressService(CONFIG);
    
    document.getElementById('settingsModal').classList.add('hidden');
    this.showToast('Settings saved', 'success');
  }

  // Sheet Management Methods
  async loadSheetInfo() {
    try {
      const response = await fetch('/api/sheet-url');
      const data = await response.json();
      
      const connectBtn = document.getElementById('connectSheetBtn');
      const switchBtn = document.getElementById('switchSheetBtn');
      const disconnectBtn = document.getElementById('disconnectSheetBtn');
      
      if (data.configured) {
        document.getElementById('currentSheetName').textContent = `📊 ${data.name || 'Spreadsheet'}`;
        connectBtn.classList.add('hidden');
        switchBtn.classList.remove('hidden');
        disconnectBtn.classList.remove('hidden');
      } else {
        document.getElementById('currentSheetName').textContent = '📊 No sheet connected';
        connectBtn.classList.remove('hidden');
        switchBtn.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
      }
    } catch (error) {
      console.error('Failed to load sheet info:', error);
    }
  }

  async disconnectSheet() {
    if (!confirm('Disconnect current sheet?')) return;
    
    try {
      const response = await fetch('/api/sheet-url', {
        method: 'DELETE'
      });
      
      if (response.ok) {
        CONFIG.SHEET_URL = '';
        this.sheetsService = new SheetsService('');
        this.articles = [];
        this.renderTable();
        this.updateStats();
        this.loadSheetInfo();
        this.showToast('Sheet disconnected', 'success');
      }
    } catch (error) {
      this.showToast('Failed to disconnect sheet', 'error');
    }
  }

  async loadSavedSheets() {
    try {
      const response = await fetch('/api/sheets');
      this.savedSheets = await response.json();
      this.renderSavedSheets();
    } catch (error) {
      console.error('Failed to load saved sheets:', error);
    }
  }

  renderSavedSheets() {
    const container = document.getElementById('savedSheetsList');
    
    if (this.savedSheets.length === 0) {
      container.innerHTML = '<p class="text-muted">No sheets saved yet</p>';
      return;
    }

    container.innerHTML = this.savedSheets.map(sheet => `
      <div class="sheet-item ${sheet.url === CONFIG.SHEET_URL ? 'active' : ''}" data-id="${sheet.id}">
        <div class="sheet-item-info">
          <div class="sheet-item-name">${this.escapeHtml(sheet.name)}</div>
          <div class="sheet-item-url">${this.escapeHtml(sheet.url)}</div>
        </div>
        <div class="sheet-item-actions">
          <button class="btn btn-small btn-primary" onclick="app.switchToSheet('${sheet.id}')">Switch</button>
          <button class="btn btn-small btn-danger" onclick="app.deleteSheet('${sheet.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  openSheetManagerModal() {
    this.renderSavedSheets();
    document.getElementById('sheetManagerModal').classList.remove('hidden');
  }

  async addNewSheet() {
    const url = document.getElementById('newSheetUrl').value.trim();
    const name = document.getElementById('newSheetName').value.trim() || 'Spreadsheet';
    
    if (!url) {
      this.showToast('Please enter a sheet URL', 'error');
      return;
    }

    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name })
      });

      if (response.ok) {
        this.showToast('Sheet added successfully', 'success');
        document.getElementById('newSheetUrl').value = '';
        document.getElementById('newSheetName').value = '';
        await this.loadSavedSheets();
        
        // Also switch to this sheet
        const data = await response.json();
        await this.switchToSheet(data.sheet.id);
      } else {
        const error = await response.json();
        this.showToast(error.error || 'Failed to add sheet', 'error');
      }
    } catch (error) {
      this.showToast('Failed to add sheet', 'error');
    }
  }

  async switchToSheet(id) {
    try {
      const response = await fetch(`/api/sheets/${id}/switch`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        CONFIG.SHEET_URL = data.sheet.url;
        this.sheetsService = new SheetsService(CONFIG.SHEET_URL);
        
        document.getElementById('currentSheetName').textContent = `📊 ${data.sheet.name}`;
        document.getElementById('sheetManagerModal').classList.add('hidden');
        
        this.showToast(`Switched to ${data.sheet.name}`, 'success');
        this.loadData();
      }
    } catch (error) {
      this.showToast('Failed to switch sheet', 'error');
    }
  }

  async deleteSheet(id) {
    if (!confirm('Are you sure you want to delete this sheet?')) return;

    try {
      const response = await fetch(`/api/sheets/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        this.showToast('Sheet deleted', 'success');
        await this.loadSavedSheets();
      }
    } catch (error) {
      this.showToast('Failed to delete sheet', 'error');
    }
  }

  showLoading(show) {
    document.getElementById('loadingState').classList.toggle('hidden', !show);
    document.getElementById('articlesTable').classList.toggle('hidden', show);
  }

  showError(show, message = '') {
    document.getElementById('errorState').classList.toggle('hidden', !show);
    if (show) {
      document.getElementById('errorMessage').textContent = message;
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WordPressClawApp();
});
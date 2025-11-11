// AI Logs and System Logs Viewer

interface AILog {
  type: 'extraction' | 'analysis';
  timestamp: number;
  prompt: string;
  response: string;
}

interface SystemLog {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  timestamp: number;
  message: string;
  context?: string;
  data?: any;
  stack?: string;
}

type LogEntry = (AILog & { key: string; logType: 'ai' }) | (SystemLog & { key: string; logType: 'system' });

let allLogs: LogEntry[] = [];
let currentFilter: 'all' | 'ai' | 'system' | 'error' = 'all';

async function loadLogs() {
  const storage = await chrome.storage.local.get(null);
  
  // Load AI logs
  const aiLogs = Object.entries(storage)
    .filter(([key]) => key.startsWith('ai_log_'))
    .map(([key, value]: [string, any]) => ({ key, ...value, logType: 'ai' as const }));
  
  // Load system logs
  const systemLogs = Object.entries(storage)
    .filter(([key]) => key.startsWith('log_'))
    .map(([key, value]: [string, any]) => ({ key, ...value, logType: 'system' as const }));
  
  allLogs = [...aiLogs, ...systemLogs].sort((a, b) => b.timestamp - a.timestamp);
  
  displayLogs();
  updateStats();
}

function displayLogs() {
  const listEl = document.getElementById('logList');
  if (!listEl) return;

  // Filter logs based on current filter
  let filteredLogs = allLogs;
  if (currentFilter === 'ai') {
    filteredLogs = allLogs.filter(log => log.logType === 'ai');
  } else if (currentFilter === 'system') {
    filteredLogs = allLogs.filter(log => log.logType === 'system');
  } else if (currentFilter === 'error') {
    filteredLogs = allLogs.filter(log => 
      log.logType === 'system' && (log as SystemLog).level === 'ERROR'
    );
  }

  if (filteredLogs.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No logs found. Logs will appear here after operations.</div>';
    return;
  }

  listEl.innerHTML = filteredLogs.map((log) => {
    const index = allLogs.indexOf(log);
    const detailId = `log-detail-${index}`;
    
    if (log.logType === 'ai') {
      const aiLog = log as AILog & { key: string; logType: 'ai' };
      return `
        <div class="log-item-wrapper">
          <div class="log-item ai-log" data-index="${index}" data-detail-id="${detailId}">
            <div class="log-header">
              <span class="log-type">${aiLog.type === 'extraction' ? '📥 AI Extraction' : '📊 AI Analysis'}</span>
              <span class="log-time">${new Date(aiLog.timestamp).toLocaleString()}</span>
            </div>
            <div class="log-stats">
              Prompt: ${aiLog.prompt?.length || 0} chars | Response: ${aiLog.response?.length || 0} chars
            </div>
          </div>
          <div id="${detailId}" class="log-detail-inline" style="display: none;"></div>
        </div>
      `;
    } else {
      const sysLog = log as SystemLog & { key: string; logType: 'system' };
      const levelClass = sysLog.level.toLowerCase();
      const levelIcon = {
        DEBUG: '🔍',
        INFO: 'ℹ️',
        WARN: '⚠️',
        ERROR: '❌'
      }[sysLog.level];
      
      return `
        <div class="log-item-wrapper">
          <div class="log-item system-log ${levelClass}" data-index="${index}" data-detail-id="${detailId}">
            <div class="log-header">
              <span class="log-type">${levelIcon} ${sysLog.level}</span>
              <span class="log-time">${new Date(sysLog.timestamp).toLocaleString()}</span>
            </div>
            <div class="log-message">${escapeHtml(sysLog.message)}</div>
          </div>
          <div id="${detailId}" class="log-detail-inline" style="display: none;"></div>
        </div>
      `;
    }
  }).join('');
  
  // Add click listeners to log items
  listEl.querySelectorAll('.log-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0');
      const detailId = (item as HTMLElement).dataset.detailId || '';
      showLogDetail(index, detailId);
    });
  });
}

function showLogDetail(index: number, detailId: string) {
  const log = allLogs[index];
  const detailEl = document.getElementById(detailId);
  if (!detailEl) return;

  // Toggle visibility - if already shown, hide it
  if (detailEl.style.display === 'block') {
    detailEl.style.display = 'none';
    return;
  }

  // Hide all other detail sections
  document.querySelectorAll('.log-detail-inline').forEach(el => {
    (el as HTMLElement).style.display = 'none';
  });

  // Show this detail section
  detailEl.style.display = 'block';
  
  if (log.logType === 'ai') {
    const aiLog = log as AILog & { key: string; logType: 'ai' };
    detailEl.innerHTML = `
      <div class="log-detail">
        <h2>${aiLog.type === 'extraction' ? '📥 AI Extraction Log' : '📊 AI Analysis Log'}</h2>
        <p><strong>Time:</strong> ${new Date(aiLog.timestamp).toLocaleString()}</p>
        
        <div class="log-section">
          <h3>Prompt (${aiLog.prompt?.length || 0} characters)</h3>
          <div class="log-content">${escapeHtml(aiLog.prompt || 'No prompt')}</div>
        </div>
        
        <div class="log-section">
          <h3>Response (${aiLog.response?.length || 0} characters)</h3>
          <div class="log-content">${escapeHtml(aiLog.response || 'No response')}</div>
        </div>
        
        <button id="copyPromptBtn-${index}" data-index="${index}">📋 Copy Prompt</button>
        <button id="copyResponseBtn-${index}" data-index="${index}">📋 Copy Response</button>
        <button id="deleteLogBtn-${index}" class="danger" data-key="${aiLog.key}">🗑️ Delete This Log</button>
      </div>
    `;
    
    detailEl.querySelector(`#copyPromptBtn-${index}`)?.addEventListener('click', () => copyToClipboard('prompt', index));
    detailEl.querySelector(`#copyResponseBtn-${index}`)?.addEventListener('click', () => copyToClipboard('response', index));
    detailEl.querySelector(`#deleteLogBtn-${index}`)?.addEventListener('click', () => deleteLog(aiLog.key));
  } else {
    const sysLog = log as SystemLog & { key: string; logType: 'system' };
    const levelIcon = {
      DEBUG: '🔍',
      INFO: 'ℹ️',
      WARN: '⚠️',
      ERROR: '❌'
    }[sysLog.level];
    
    detailEl.innerHTML = `
      <div class="log-detail">
        <h2>${levelIcon} ${sysLog.level} Log</h2>
        <p><strong>Time:</strong> ${new Date(sysLog.timestamp).toLocaleString()}</p>
        <p><strong>Message:</strong> ${escapeHtml(sysLog.message)}</p>
        
        ${sysLog.data ? `
          <div class="log-section">
            <h3>Data</h3>
            <div class="log-content"><pre>${escapeHtml(JSON.stringify(sysLog.data, null, 2))}</pre></div>
          </div>
        ` : ''}
        
        ${sysLog.stack ? `
          <div class="log-section">
            <h3>Stack Trace</h3>
            <div class="log-content"><pre>${escapeHtml(sysLog.stack)}</pre></div>
          </div>
        ` : ''}
        
        <button id="copyLogBtn-${index}" data-index="${index}">📋 Copy Log</button>
        <button id="deleteLogBtn-${index}" class="danger" data-key="${sysLog.key}">🗑️ Delete This Log</button>
      </div>
    `;
    
    detailEl.querySelector(`#copyLogBtn-${index}`)?.addEventListener('click', () => copySystemLog(index));
    detailEl.querySelector(`#deleteLogBtn-${index}`)?.addEventListener('click', () => deleteLog(sysLog.key));
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function copyToClipboard(type: 'prompt' | 'response', index: number) {
  const log = allLogs[index] as AILog & { key: string; logType: 'ai' };
  const text = type === 'prompt' ? log.prompt : log.response;
  
  try {
    await navigator.clipboard.writeText(text);
    alert(`${type} copied to clipboard!`);
  } catch (error) {
    console.error('Failed to copy:', error);
    alert('Failed to copy to clipboard');
  }
}

async function copySystemLog(index: number) {
  const log = allLogs[index] as SystemLog & { key: string; logType: 'system' };
  const text = JSON.stringify({
    level: log.level,
    timestamp: new Date(log.timestamp).toISOString(),
    message: log.message,
    data: log.data,
    stack: log.stack,
  }, null, 2);
  
  try {
    await navigator.clipboard.writeText(text);
    alert('Log copied to clipboard!');
  } catch (error) {
    console.error('Failed to copy:', error);
    alert('Failed to copy to clipboard');
  }
}

async function deleteLog(key: string) {
  if (!confirm('Delete this log?')) return;
  
  await chrome.storage.local.remove(key);
  await loadLogs();
}

async function clearLogs() {
  if (!confirm('Clear all logs? This cannot be undone!')) return;
  
  const logKeys = allLogs.map(log => log.key);
  await chrome.storage.local.remove(logKeys);
  allLogs = [];
  displayLogs();
  updateStats();
  alert('All logs cleared');
}

function setFilter(filter: 'all' | 'ai' | 'system' | 'error') {
  currentFilter = filter;
  
  // Update button states
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-filter="${filter}"]`)?.classList.add('active');
  
  displayLogs();
}

function updateStats() {
  const aiLogs = allLogs.filter(log => log.logType === 'ai');
  const systemLogs = allLogs.filter(log => log.logType === 'system');
  const errorLogs = systemLogs.filter(log => (log as SystemLog).level === 'ERROR');
  
  const statsEl = document.getElementById('logStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <span>Total: ${allLogs.length}</span>
      <span>AI: ${aiLogs.length}</span>
      <span>System: ${systemLogs.length}</span>
      <span>Errors: ${errorLogs.length}</span>
    `;
  }
}

async function exportLogs() {
  const data = JSON.stringify(allLogs, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Add event listeners to control buttons
  document.getElementById('refreshBtn')?.addEventListener('click', loadLogs);
  document.getElementById('exportBtn')?.addEventListener('click', exportLogs);
  document.getElementById('clearBtn')?.addEventListener('click', clearLogs);
  
  // Add filter button listeners
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = (e.target as HTMLElement).dataset.filter as 'all' | 'ai' | 'system' | 'error';
      if (filter) setFilter(filter);
    });
  });
  
  // Load logs
  loadLogs();
});

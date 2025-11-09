/**
 * View AI Extraction Logs
 * 
 * This script helps you view the AI extraction logs stored in chrome.storage.local
 * 
 * Usage:
 * 1. Open Chrome DevTools Console in the extension's background page
 * 2. Copy and paste this script
 * 3. Run: viewAILogs() to see all logs
 * 4. Run: viewLatestLog() to see the most recent log
 * 5. Run: clearAILogs() to clear all logs
 */

async function viewAILogs() {
  const storage = await chrome.storage.local.get(null);
  const logs = Object.entries(storage)
    .filter(([key]) => key.startsWith('ai_log_'))
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.timestamp - a.timestamp);
  
  console.log(`Found ${logs.length} AI logs:`);
  logs.forEach((log, index) => {
    console.log(`\n=== Log ${index + 1} ===`);
    console.log('Type:', log.type);
    console.log('Time:', new Date(log.timestamp).toLocaleString());
    console.log('Prompt length:', log.prompt?.length || 0);
    console.log('Response length:', log.response?.length || 0);
  });
  
  return logs;
}

async function viewLatestLog() {
  const logs = await viewAILogs();
  if (logs.length === 0) {
    console.log('No logs found');
    return null;
  }
  
  const latest = logs[0];
  console.log('\n=== LATEST LOG DETAILS ===');
  console.log('Type:', latest.type);
  console.log('Time:', new Date(latest.timestamp).toLocaleString());
  console.log('\n--- PROMPT ---');
  console.log(latest.prompt);
  console.log('\n--- RESPONSE ---');
  console.log(latest.response);
  
  return latest;
}

async function clearAILogs() {
  const storage = await chrome.storage.local.get(null);
  const logKeys = Object.keys(storage).filter(key => key.startsWith('ai_log_'));
  
  if (logKeys.length === 0) {
    console.log('No logs to clear');
    return;
  }
  
  await chrome.storage.local.remove(logKeys);
  console.log(`Cleared ${logKeys.length} logs`);
}

async function exportLogsToFile() {
  const logs = await viewAILogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  console.log('Logs exported to file');
}

console.log('AI Log Viewer loaded. Available commands:');
console.log('- viewAILogs() - View all logs');
console.log('- viewLatestLog() - View the most recent log');
console.log('- clearAILogs() - Clear all logs');
console.log('- exportLogsToFile() - Export logs to JSON file');

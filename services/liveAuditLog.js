/**
 * services/liveAuditLog.js
 * Daily live data audit logger.
 * Records query, category, source, timestamp, and context preview for auditing.
 * CRITICAL RULE: This log is write-only for audit history. It is NEVER served as today's live facts.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data');
const AUDIT_FILE = path.join(LOG_DIR, 'live_audit_log.jsonl');

function recordLiveAudit(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const logItem = {
      timestamp: new Date().toISOString(),
      category: entry.category || 'general_live',
      query: entry.query || '',
      source: entry.source || 'Unknown',
      valuePreview: (entry.valuePreview || '').substring(0, 200),
      status: entry.status || 'success',
    };
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(logItem) + '\n', 'utf8');
    return logItem;
  } catch (err) {
    // Non-blocking logger
    console.warn('[LiveAuditLog] Failed to record audit log:', err.message);
    return null;
  }
}

function readLiveAuditLog(limit = 10) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    return entries;
  } catch (err) {
    console.warn('[LiveAuditLog] read error:', err.message);
    return [];
  }
}

module.exports = {
  recordLiveAudit,
  readLiveAuditLog,
  AUDIT_FILE,
};


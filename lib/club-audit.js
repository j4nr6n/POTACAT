// Club Station Mode — Audit logger
// Append-only CSV log of login/logout/tune/PTT events for club accountability

const fs = require('fs');
const path = require('path');

const HEADER = 'timestamp,callsign,event,details\n';

/**
 * Create an audit logger that appends CSV lines to filePath.
 * @param {string} filePath — absolute path to audit CSV
 * @returns {{ log(callsign, event, details): void }}
 */
function createAuditLogger(filePath) {
  if (!filePath) return { log() {} };

  // Ensure directory exists
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}

  // Write header if file doesn't exist
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, HEADER);
    }
  } catch (err) {
    console.error('[Club Audit] Failed to create audit log:', err.message);
  }

  return {
    log(callsign, event, details) {
      const ts = new Date().toISOString();
      const detailStr = (details || '').replace(/"/g, '""');
      const line = `${ts},${callsign || ''},${event || ''},"${detailStr}"\n`;
      try {
        fs.appendFileSync(filePath, line);
      } catch (err) {
        console.error('[Club Audit] Write failed:', err.message);
      }
    },
  };
}

module.exports = { createAuditLogger };

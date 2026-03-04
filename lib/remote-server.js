// ECHO CAT server — HTTPS + WebSocket for phone-based remote radio control
// Serves mobile web UI, relays spots/tune/PTT commands, and WebRTC signaling
// Uses self-signed TLS certificate so getUserMedia() works on mobile browsers
// (navigator.mediaDevices requires a secure context: https or localhost)
const http = require('http');
const https = require('https');
const tls = require('tls');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

/**
 * Generate a self-signed TLS certificate using openssl CLI.
 * Caches the cert/key in the given directory so it persists across restarts.
 * Falls back to null if openssl is not available.
 */
function getOrCreateTlsCert(certDir) {
  const certPath = path.join(certDir, 'remote-cert.pem');
  const keyPath = path.join(certDir, 'remote-key.pem');

  // Return cached cert if it exists and is less than 1 year old
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const stat = fs.statSync(certPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 365 * 24 * 60 * 60 * 1000) {
        return {
          cert: fs.readFileSync(certPath, 'utf8'),
          key: fs.readFileSync(keyPath, 'utf8'),
        };
      }
    } catch {}
  }

  // Generate new self-signed cert via openssl
  try {
    // Find openssl — commonly bundled with Git on Windows
    const subj = '/CN=ECHO CAT/O=POTACAT';
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "${subj}" -addext "subjectAltName=IP:127.0.0.1"`,
      { stdio: 'pipe', timeout: 10000 }
    );
    console.log('[Echo CAT] Generated self-signed TLS certificate');
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
    };
  } catch (err) {
    console.warn('[Echo CAT] Could not generate TLS cert (openssl not found?):', err.message);
    console.warn('[Echo CAT] Falling back to plain HTTP — audio will NOT work on mobile');
    return null;
  }
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Only serve these files to the phone
const ALLOWED_FILES = new Set([
  'remote.html', 'remote.js', 'remote.css',
]);

class RemoteServer extends EventEmitter {
  constructor() {
    super();
    this._httpServer = null;
    this._wss = null;
    this._client = null;       // single authenticated WebSocket
    this._port = 7300;
    this._token = null;
    this._pttSafetyTimer = null;
    this._pttSafetyTimeout = 180; // seconds
    this._pttActive = false;
    this._lastTuneTime = 0;
    this._lastSpots = [];
    this._radioStatus = { freq: 0, mode: '', catConnected: false, txState: false };
    this.running = false;
    this._basePath = null;     // resolved path to renderer/ directory
  }

  start(port, token, opts = {}) {
    this._port = port || 7300;
    this._token = token;
    this._requireToken = opts.requireToken !== false; // default true
    this._pttSafetyTimeout = opts.pttSafetyTimeout || 180;
    this._https = false;

    // Resolve renderer directory (works in dev and packaged builds)
    this._basePath = opts.rendererPath || path.join(__dirname, '..', 'renderer');

    const handler = (req, res) => this._handleHttpRequest(req, res);

    // Try HTTPS first (required for getUserMedia on mobile browsers)
    const certDir = opts.certDir || path.join(__dirname, '..');
    const tlsCert = getOrCreateTlsCert(certDir);

    if (tlsCert) {
      this._httpServer = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, handler);
      this._https = true;
    } else {
      this._httpServer = http.createServer(handler);
    }

    this._wss = new WebSocket.Server({ server: this._httpServer });
    this._wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // Track open sockets so we can destroy them on stop()
    this._sockets = new Set();
    this._httpServer.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });
    this._httpServer.on('secureConnection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    this._httpServer.listen(this._port, '0.0.0.0', () => {
      this.running = true;
      const proto = this._https ? 'https' : 'http';
      this.emit('started', { port: this._port, https: this._https });
      console.log(`[Echo CAT] Server listening on ${proto}://0.0.0.0:${this._port}`);
    });

    this._httpServer.on('error', (err) => {
      console.error('[Echo CAT] Server error:', err.message);
      this.emit('error', err);
    });
  }

  stop() {
    if (this._pttActive) {
      this._pttActive = false;
      this.emit('ptt', { state: false });
    }
    if (this._pttSafetyTimer) {
      clearTimeout(this._pttSafetyTimer);
      this._pttSafetyTimer = null;
    }
    if (this._client) {
      try { this._client.close(); } catch {}
      this._client = null;
    }
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }
    if (this._httpServer) {
      this._httpServer.close();
      // Destroy all open TCP sockets so the process can exit.
      // httpServer.close() only stops accepting new connections —
      // existing keep-alive / WebSocket sockets hold the event loop open.
      if (this._sockets) {
        for (const socket of this._sockets) {
          socket.destroy();
        }
        this._sockets.clear();
      }
      this._httpServer = null;
    }
    this.running = false;
    console.log('[Echo CAT] Server stopped');
  }

  // --- HTTP ---

  _handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    // Route / to remote.html
    if (pathname === '/') pathname = '/remote.html';

    const filename = pathname.slice(1); // strip leading /
    if (!ALLOWED_FILES.has(filename)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const filePath = path.join(this._basePath, filename);
    const ext = path.extname(filename);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  // --- WebSocket ---

  _handleConnection(ws, req) {
    const addr = req.socket.remoteAddress;
    console.log(`[Echo CAT] New connection from ${addr}`);

    // Kick existing client
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'kicked', reason: 'Another client connected' });
      try { this._client.close(); } catch {}
      this._onClientDisconnected();
    }

    ws._authenticated = false;

    // If token is not required, auto-authenticate immediately
    if (!this._requireToken) {
      ws._authenticated = true;
      this._client = ws;
      this._sendTo(ws, { type: 'auth-ok' });
      if (this._lastSpots.length > 0) {
        this._sendTo(ws, { type: 'spots', data: this._lastSpots });
      }
      this._sendTo(ws, { type: 'status', ...this._radioStatus });
      this.emit('client-connected', { address: addr });
      console.log('[Echo CAT] Client auto-authenticated (no token required)');
    }

    // Auth timeout: must authenticate within 10 seconds
    const authTimer = !this._requireToken ? null : setTimeout(() => {
      if (!ws._authenticated) {
        this._sendTo(ws, { type: 'auth-fail', reason: 'Timeout' });
        ws.close();
      }
    }, 10000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this._handleMessage(ws, msg);
    });

    ws.on('close', () => {
      if (authTimer) clearTimeout(authTimer);
      if (ws === this._client) {
        this._onClientDisconnected();
      }
    });

    ws.on('error', (err) => {
      console.error('[Echo CAT] WebSocket error:', err.message);
    });
  }

  _handleMessage(ws, msg) {
    // Auth
    if (msg.type === 'auth') {
      // Already authenticated (e.g. token not required) — ignore
      if (ws._authenticated) return;
      if (msg.token && this._token && msg.token.toUpperCase() === this._token.toUpperCase()) {
        ws._authenticated = true;
        this._client = ws;
        this._sendTo(ws, { type: 'auth-ok' });
        // Send cached state
        if (this._lastSpots.length > 0) {
          this._sendTo(ws, { type: 'spots', data: this._lastSpots });
        }
        this._sendTo(ws, { type: 'status', ...this._radioStatus });
        this.emit('client-connected', { address: ws._socket?.remoteAddress });
        console.log('[Echo CAT] Client authenticated');
      } else {
        this._sendTo(ws, { type: 'auth-fail', reason: 'Invalid token' });
      }
      return;
    }

    // All other messages require auth
    if (!ws._authenticated || ws !== this._client) return;

    switch (msg.type) {
      case 'tune': {
        const now = Date.now();
        if (now - this._lastTuneTime < 500) break; // rate limit
        this._lastTuneTime = now;
        this.emit('tune', {
          freqKhz: msg.freqKhz,
          mode: msg.mode,
          bearing: msg.bearing,
        });
        break;
      }

      case 'ptt':
        this._handlePtt(!!msg.state);
        break;

      case 'estop':
        // Emergency stop — no rate limiting
        this._handlePtt(false);
        break;

      case 'signal':
        // WebRTC signaling relay
        this.emit('signal-from-client', msg.data);
        break;

      case 'set-sources':
        this.emit('set-sources', msg.sources);
        break;

      case 'log-qso':
        this.emit('log-qso', msg.data);
        break;

      case 'ping':
        this._sendTo(ws, { type: 'pong', ts: msg.ts });
        break;
    }
  }

  _handlePtt(state) {
    if (this._pttSafetyTimer) {
      clearTimeout(this._pttSafetyTimer);
      this._pttSafetyTimer = null;
    }

    if (state) {
      // Start safety timer
      this._pttSafetyTimer = setTimeout(() => {
        console.log('[Echo CAT] PTT safety timeout — forcing RX');
        this._pttActive = false;
        this.emit('ptt', { state: false });
        // Notify phone
        if (this._client && this._client.readyState === WebSocket.OPEN) {
          this._sendTo(this._client, {
            type: 'ptt-timeout',
            message: 'PTT safety timeout reached — auto-RX',
          });
        }
      }, this._pttSafetyTimeout * 1000);
    }

    this._pttActive = state;
    this.emit('ptt', { state });
  }

  _onClientDisconnected() {
    // Force RX if PTT was active
    if (this._pttActive) {
      this._pttActive = false;
      if (this._pttSafetyTimer) {
        clearTimeout(this._pttSafetyTimer);
        this._pttSafetyTimer = null;
      }
      this.emit('ptt', { state: false });
      console.log('[Echo CAT] Client disconnected while TX — forcing RX');
    }
    this._client = null;
    this.emit('client-disconnected');
    console.log('[Echo CAT] Client disconnected');
  }

  // --- Broadcasting ---

  broadcastSpots(spots) {
    this._lastSpots = spots;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'spots', data: spots });
    }
  }

  broadcastRadioStatus(status) {
    this._radioStatus = { ...this._radioStatus, ...status };
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'status', ...this._radioStatus });
    }
  }

  sendSourcesToClient(sources) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'sources', data: sources });
    }
  }

  sendLogResult(result) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'log-ok', ...result });
    }
  }

  relaySignalToClient(data) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'signal', data });
    }
  }

  hasClient() {
    return !!(this._client && this._client.readyState === WebSocket.OPEN && this._client._authenticated);
  }

  // --- Helpers ---

  _sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }

  static generateToken() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  static getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({
            name,
            address: addr.address,
            tailscale: addr.address.startsWith('100.'),
          });
        }
      }
    }
    // Tailscale IPs first
    ips.sort((a, b) => (b.tailscale ? 1 : 0) - (a.tailscale ? 1 : 0));
    return ips;
  }
}

module.exports = { RemoteServer };

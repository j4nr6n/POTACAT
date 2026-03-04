// ECHO CAT — Phone-side client
// Runs in Safari/Chrome, no Electron dependencies
(function () {
  'use strict';

  // --- State ---
  let ws = null;
  let spots = [];
  let bandFilter = 'all';
  let pttDown = false;
  let storedToken = '';
  let reconnectTimer = null;
  let pingInterval = null;
  let lastPingSent = 0;

  // WebRTC
  let pc = null;
  let localAudioStream = null;
  let audioEnabled = false;
  let remoteAudio = null; // <audio> element for playback

  // --- Elements ---
  const connectScreen = document.getElementById('connect-screen');
  const tokenInput = document.getElementById('token-input');
  const connectBtn = document.getElementById('connect-btn');
  const connectError = document.getElementById('connect-error');
  const mainUI = document.getElementById('main-ui');
  const freqDisplay = document.getElementById('freq-display');
  const modeBadge = document.getElementById('mode-badge');
  const catDot = document.getElementById('cat-dot');
  const audioDot = document.getElementById('audio-dot');
  const latencyEl = document.getElementById('latency');
  const txBanner = document.getElementById('tx-banner');
  const spotList = document.getElementById('spot-list');
  const pttBtn = document.getElementById('ptt-btn');
  const estopBtn = document.getElementById('estop-btn');
  const audioBtn = document.getElementById('audio-btn');
  const statusBar = document.getElementById('status-bar');
  const freqInput = document.getElementById('freq-input');
  const freqGo = document.getElementById('freq-go');
  const logBtn = document.getElementById('log-btn');
  const logSheet = document.getElementById('log-sheet');
  const logBackdrop = document.getElementById('log-sheet-backdrop');
  const logForm = document.getElementById('log-form');
  const logCall = document.getElementById('log-call');
  const logFreq = document.getElementById('log-freq');
  const logMode = document.getElementById('log-mode');
  const logRstSent = document.getElementById('log-rst-sent');
  const logRstRcvd = document.getElementById('log-rst-rcvd');
  const logSig = document.getElementById('log-sig');
  const logSigInfo = document.getElementById('log-sig-info');
  const logSaveBtn = document.getElementById('log-save');
  const logCancelBtn = document.getElementById('log-cancel');
  const logToast = document.getElementById('log-toast');
  const rigBar = document.getElementById('rig-bar');
  const rigSelect = document.getElementById('rig-select');
  let currentFreqKhz = 0; // track current freq for pre-fill
  let currentMode = '';    // track current mode
  let tunedFreqKhz = ''; // last tuned spot freq for highlight

  // --- Connect ---
  connectBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim().toUpperCase();
    if (!token) return;
    storedToken = token;
    connectError.classList.add('hidden');
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;
    connect(token);
  });

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  function connect(token) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      // Send auth with token (server ignores if token not required)
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      pingInterval = null;
      if (mainUI.classList.contains('hidden')) {
        // Still on connect screen
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
      } else {
        // Was connected — show reconnecting state
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'auth-ok':
        connectScreen.classList.add('hidden');
        mainUI.classList.remove('hidden');
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        startPing();
        showWelcome();
        break;

      case 'auth-fail':
        connectError.textContent = msg.reason || 'Authentication failed';
        connectError.classList.remove('hidden');
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        break;

      case 'spots':
        spots = msg.data || [];
        renderSpots();
        break;

      case 'status':
        updateStatus(msg);
        break;

      case 'pong':
        if (msg.ts) {
          const latMs = Date.now() - msg.ts;
          latencyEl.textContent = latMs + 'ms';
        }
        break;

      case 'ptt-timeout':
        pttDown = false;
        pttBtn.classList.remove('active');
        txBanner.classList.add('hidden');
        break;

      case 'kicked':
        alert('Disconnected: another client connected');
        location.reload();
        break;

      case 'sources':
        // Sync source toggles from POTACAT settings
        if (msg.data) {
          const map = { pota: 'pota', sota: 'sota', wwff: 'wwff', llota: 'llota', cluster: 'dxc' };
          for (const [settingKey, srcAttr] of Object.entries(map)) {
            const chip = document.querySelector(`#source-bar .source-chip[data-src="${srcAttr}"]`);
            if (chip) chip.classList.toggle('active', !!msg.data[settingKey]);
          }
        }
        break;

      case 'rigs':
        updateRigSelect(msg.data || [], msg.activeRigId);
        break;

      case 'log-ok':
        logSaveBtn.disabled = false;
        if (msg.success) {
          closeLogSheet();
          showLogToast('Logged ' + (msg.callsign || ''));
        } else {
          showLogToast(msg.error || 'Log failed', true);
        }
        break;

      case 'signal':
        handleSignal(msg.data);
        break;
    }
  }

  // --- Status ---
  function updateStatus(s) {
    if (s.freq) {
      freqDisplay.textContent = formatFreq(s.freq);
      currentFreqKhz = s.freq / 1000;
    }
    if (s.mode) {
      modeBadge.textContent = s.mode;
      currentMode = s.mode;
      // Hide PTT controls when mode is not SSB
      const m = s.mode.toUpperCase();
      const isSSB = (m === 'SSB' || m === 'USB' || m === 'LSB');
      pttBtn.classList.toggle('hidden', !isSSB);
      estopBtn.classList.toggle('hidden', !isSSB);
    }
    if (s.catConnected !== undefined) {
      catDot.classList.toggle('connected', s.catConnected);
      catDot.title = s.catConnected ? 'Radio connected' : 'Radio disconnected';
    }
    if (s.txState !== undefined) {
      txBanner.classList.toggle('hidden', !s.txState);
      if (!s.txState && pttDown) {
        // Server forced RX
        pttDown = false;
        pttBtn.classList.remove('active');
      }
    }
  }

  function formatFreq(hz) {
    // Format Hz as "14.074.000"
    const mhz = Math.floor(hz / 1e6);
    const khz = Math.floor((hz % 1e6) / 1e3);
    const sub = Math.floor(hz % 1e3);
    return `${mhz}.${String(khz).padStart(3, '0')}.${String(sub).padStart(3, '0')}`;
  }

  // --- Spots ---
  function renderSpots() {
    const filtered = spots.filter(s => {
      if (bandFilter !== 'all' && s.band !== bandFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      spotList.innerHTML = '<div class="spot-empty">No spots</div>';
      return;
    }

    // Sort by age (newest first)
    filtered.sort((a, b) => {
      const ta = parseSpotTime(a.spotTime);
      const tb = parseSpotTime(b.spotTime);
      return tb - ta;
    });

    spotList.innerHTML = filtered.map(s => {
      const srcClass = 'source-' + (s.source || 'pota');
      const tunedClass = (tunedFreqKhz && s.frequency === tunedFreqKhz) ? ' tuned' : '';
      const refClass = s.source === 'sota' ? 'sota' : s.source === 'dxc' ? 'dxc' : '';
      const ref = s.reference || s.locationDesc || '';
      const age = formatAge(s.spotTime);
      const freqStr = formatSpotFreq(s.frequency);
      const src = s.source || 'pota';
      return `<div class="spot-card ${srcClass}${tunedClass}" data-freq="${s.frequency}" data-mode="${s.mode || ''}" data-bearing="${s.bearing || ''}" data-call="${esc(s.callsign)}" data-ref="${esc(ref)}" data-src="${src}">
        <span class="spot-call">${esc(s.callsign)}</span>
        <span class="spot-freq">${freqStr}</span>
        <span class="spot-mode">${esc(s.mode || '?')}</span>
        <span class="spot-ref ${refClass}">${esc(ref)}</span>
        <span class="spot-age">${age}</span>
        <button type="button" class="spot-log-btn">Log</button>
      </div>`;
    }).join('');
  }

  function formatSpotFreq(kHz) {
    const num = parseFloat(kHz);
    if (isNaN(num)) return kHz;
    return num.toFixed(1);
  }

  function parseSpotTime(t) {
    if (!t) return 0;
    // POTA times may lack Z suffix
    const s = t.endsWith('Z') ? t : t + 'Z';
    return new Date(s).getTime() || 0;
  }

  function formatAge(t) {
    const ms = Date.now() - parseSpotTime(t);
    if (ms < 0 || isNaN(ms)) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return '<1m';
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return rm > 0 ? `${hr}h ${rm}m` : `${hr}h`;
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Tune (tap on spot) or Log ---
  spotList.addEventListener('click', (e) => {
    // Check if Log button was tapped
    const logTarget = e.target.closest('.spot-log-btn');
    if (logTarget) {
      const card = logTarget.closest('.spot-card');
      if (card) {
        openLogSheet({
          callsign: card.dataset.call || '',
          freqKhz: card.dataset.freq || '',
          mode: card.dataset.mode || '',
          sig: srcToSig(card.dataset.src),
          sigInfo: card.dataset.ref || '',
        });
      }
      return;
    }
    const card = e.target.closest('.spot-card');
    if (!card || !ws || ws.readyState !== WebSocket.OPEN) return;
    const freqKhz = card.dataset.freq;
    const mode = card.dataset.mode;
    ws.send(JSON.stringify({
      type: 'tune',
      freqKhz,
      mode,
      bearing: card.dataset.bearing ? parseFloat(card.dataset.bearing) : undefined,
    }));
    // Optimistic update — show tuned freq immediately
    const hz = parseFloat(freqKhz) * 1000;
    if (hz > 0) {
      freqDisplay.textContent = formatFreq(hz);
      currentFreqKhz = parseFloat(freqKhz);
    }
    if (mode) modeBadge.textContent = mode;
    // Highlight tuned spot
    tunedFreqKhz = freqKhz;
    spotList.querySelectorAll('.spot-card.tuned').forEach(c => c.classList.remove('tuned'));
    card.classList.add('tuned');
  });

  // --- Source toggles ---
  document.getElementById('source-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('.source-chip');
    if (!chip) return;
    chip.classList.toggle('active');
    // Send updated source state to POTACAT
    const sources = {};
    document.querySelectorAll('#source-bar .source-chip').forEach(c => {
      sources[c.dataset.src] = c.classList.contains('active');
    });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-sources', sources }));
    }
  });

  // --- Filters ---
  document.getElementById('band-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    bandFilter = chip.dataset.band;
    document.querySelectorAll('#band-filters .filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.band === bandFilter));
    renderSpots();
  });

  // --- Frequency direct input (tap freq display to edit) ---
  freqDisplay.addEventListener('click', () => {
    statusBar.classList.add('editing');
    freqInput.value = currentFreqKhz ? Math.round(currentFreqKhz * 10) / 10 : '';
    freqInput.focus();
    freqInput.select();
  });

  function submitFreq() {
    const val = parseFloat(freqInput.value);
    if (!val || isNaN(val) || val < 100 || val > 500000) {
      cancelFreqEdit();
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tune', freqKhz: val.toString(), mode: '' }));
    }
    cancelFreqEdit();
  }

  function cancelFreqEdit() {
    statusBar.classList.remove('editing');
    freqInput.blur();
  }

  freqGo.addEventListener('click', submitFreq);

  freqInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitFreq(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelFreqEdit(); }
  });

  freqInput.addEventListener('blur', () => {
    // Small delay so Go button click registers before blur hides it
    setTimeout(() => {
      if (statusBar.classList.contains('editing')) cancelFreqEdit();
    }, 200);
  });

  // --- PTT ---
  function pttStart() {
    if (pttDown) return;
    pttDown = true;
    pttBtn.classList.add('active');
    txBanner.classList.remove('hidden');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: true }));
    }
  }

  function pttStop() {
    if (!pttDown) return;
    pttDown = false;
    pttBtn.classList.remove('active');
    txBanner.classList.add('hidden');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: false }));
    }
  }

  // Touch events (hold-to-talk)
  pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); pttStart(); });
  pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); pttStop(); });
  pttBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); pttStop(); });

  // Mouse fallback (for testing in desktop browser)
  pttBtn.addEventListener('mousedown', (e) => { e.preventDefault(); pttStart(); });
  pttBtn.addEventListener('mouseup', (e) => { e.preventDefault(); pttStop(); });
  pttBtn.addEventListener('mouseleave', (e) => { if (pttDown) pttStop(); });

  // Emergency stop
  estopBtn.addEventListener('click', () => {
    pttDown = false;
    pttBtn.classList.remove('active');
    txBanner.classList.add('hidden');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'estop' }));
    }
  });

  // --- Audio (WebRTC) ---
  audioBtn.addEventListener('click', async () => {
    if (audioEnabled) {
      stopAudio();
    } else {
      await startAudio();
      // If mic permission prompt consumed the gesture, auto-retry connection
      if (micReady && !audioEnabled) {
        await startAudio();
      }
    }
  });

  const audioLabel = audioBtn.querySelector('.audio-label');

  function setAudioStatus(text) {
    audioLabel.textContent = text;
  }

  // Audio requires two phases on iOS:
  // Phase 1 (user gesture): get mic permission + prime <audio> element for playback
  // Phase 2 (user gesture): connect WebRTC (iOS may invalidate gesture context after mic prompt)
  let micReady = false;

  async function startAudio() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Phase 1: acquire mic + prime audio element
    if (!micReady) {
      try {
        setAudioStatus('Mic...');
        localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        // Prime the <audio> element during user gesture so iOS allows playback later
        remoteAudio = document.getElementById('remote-audio');
        remoteAudio.srcObject = new MediaStream();
        await remoteAudio.play().catch(() => {});
        micReady = true;
      } catch (err) {
        console.error('Audio error:', err);
        setAudioStatus('Audio');
        if (!navigator.mediaDevices) {
          alert('Audio requires HTTPS. Connect via https:// not http://');
        } else {
          alert('Could not access microphone: ' + err.message);
        }
        return;
      }
    }

    // Phase 2: connect WebRTC
    try {
      setAudioStatus('Wait...');

      pc = new RTCPeerConnection({ iceServers: [] });

      // Add phone mic track
      for (const track of localAudioStream.getTracks()) {
        pc.addTrack(track, localAudioStream);
      }

      // Receive radio RX audio — element already primed, just swap srcObject
      pc.ontrack = (event) => {
        setAudioStatus('Live');
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(() => {});
      };

      // ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'signal', data: { type: 'ice', candidate: event.candidate } }));
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc ? pc.connectionState : 'closed';
        audioDot.classList.toggle('connected', state === 'connected');
        if (state === 'connected') setAudioStatus('Live');
        else if (state === 'failed' || state === 'disconnected') stopAudio();
      };

      // Tell server to start audio bridge
      ws.send(JSON.stringify({ type: 'signal', data: { type: 'start-audio' } }));

      audioEnabled = true;
      audioBtn.classList.add('active');
      audioDot.classList.remove('hidden');

    } catch (err) {
      console.error('Audio error:', err);
      setAudioStatus('Error');
    }
  }

  function stopAudio() {
    if (pc) { pc.close(); pc = null; }
    if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
    if (remoteAudio) { remoteAudio.srcObject = null; }
    audioEnabled = false;
    micReady = false;
    audioBtn.classList.remove('active');
    audioDot.classList.add('hidden');
    audioDot.classList.remove('connected');
    setAudioStatus('Audio');
  }

  function handleSignal(data) {
    if (!data) return;

    if (data.type === 'sdp') {
      if (!pc) return;
      // Pass plain object — RTCSessionDescription constructor hangs on iOS WebKit
      pc.setRemoteDescription(data.sdp)
        .then(() => {
          if (data.sdp.type === 'offer') {
            return pc.createAnswer().then(answer => {
              return pc.setLocalDescription(answer).then(() => {
                ws.send(JSON.stringify({ type: 'signal', data: { type: 'sdp', sdp: pc.localDescription } }));
              });
            });
          }
        })
        .catch(err => {
          console.error('SDP error:', err);
          setAudioStatus('Error');
        });
    } else if (data.type === 'ice') {
      if (pc) {
        // Plain object — RTCIceCandidate constructor also deprecated on iOS
        pc.addIceCandidate(data.candidate).catch(() => {});
      }
    }
  }

  // --- Ping / Latency ---
  function startPing() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        lastPingSent = Date.now();
        ws.send(JSON.stringify({ type: 'ping', ts: lastPingSent }));
      }
    }, 3000);
  }

  // --- Reconnect ---
  let noTokenMode = false; // set true when server auto-authenticates without token
  function scheduleReconnect() {
    if (reconnectTimer) return;
    latencyEl.textContent = '--ms';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(storedToken || '');
    }, 3000);
  }

  // --- Log QSO Sheet ---
  function srcToSig(src) {
    const map = { pota: 'POTA', sota: 'SOTA', wwff: 'WWFF', llota: 'LLOTA' };
    return map[src] || '';
  }

  function defaultRst(mode) {
    const m = (mode || '').toUpperCase();
    if (m === 'CW' || m === 'FT8' || m === 'FT4' || m === 'RTTY') return '599';
    return '59';
  }

  function openLogSheet(prefill) {
    const p = prefill || {};
    logCall.value = p.callsign || '';
    logFreq.value = p.freqKhz || (currentFreqKhz ? String(Math.round(currentFreqKhz * 10) / 10) : '');
    const mode = p.mode || currentMode || 'SSB';
    logMode.value = mode;
    logRstSent.value = p.rstSent || defaultRst(mode);
    logRstRcvd.value = p.rstRcvd || defaultRst(mode);
    logSig.value = p.sig || '';
    logSigInfo.value = p.sigInfo || '';
    logSaveBtn.disabled = false;

    logSheet.classList.remove('hidden', 'slide-down');
    logBackdrop.classList.remove('hidden');
    if (!p.callsign) logCall.focus();
  }

  function closeLogSheet() {
    logSheet.classList.add('slide-down');
    setTimeout(() => {
      logSheet.classList.add('hidden');
      logSheet.classList.remove('slide-down');
      logBackdrop.classList.add('hidden');
    }, 250);
  }

  // Update RST defaults when mode changes
  logMode.addEventListener('change', () => {
    const rst = defaultRst(logMode.value);
    logRstSent.value = rst;
    logRstRcvd.value = rst;
  });

  // Bottom bar Log button — manual QSO with current freq/mode
  logBtn.addEventListener('click', () => {
    openLogSheet({
      freqKhz: currentFreqKhz ? String(Math.round(currentFreqKhz * 10) / 10) : '',
      mode: currentMode || 'SSB',
    });
  });

  logCancelBtn.addEventListener('click', closeLogSheet);
  logBackdrop.addEventListener('click', closeLogSheet);

  logForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const call = logCall.value.trim().toUpperCase();
    const freq = logFreq.value.trim();
    if (!call) { logCall.focus(); return; }
    if (!freq || isNaN(parseFloat(freq))) { logFreq.focus(); return; }

    logSaveBtn.disabled = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log-qso',
        data: {
          callsign: call,
          freqKhz: freq,
          mode: logMode.value,
          rstSent: logRstSent.value || '59',
          rstRcvd: logRstRcvd.value || '59',
          sig: logSig.value,
          sigInfo: logSigInfo.value,
        },
      }));
    }
  });

  let toastTimer = null;
  function showLogToast(msg, isError) {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    logToast.textContent = msg;
    logToast.classList.remove('hidden', 'fade-out', 'error');
    if (isError) logToast.classList.add('error');
    toastTimer = setTimeout(() => {
      logToast.classList.add('fade-out');
      setTimeout(() => {
        logToast.classList.add('hidden');
        logToast.classList.remove('fade-out', 'error');
      }, 400);
    }, 2500);
  }

  // Refresh spot ages every 30s
  setInterval(() => {
    if (spots.length > 0) renderSpots();
  }, 30000);

  // --- Welcome Tip ---
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const welcomeHide = document.getElementById('welcome-hide');
  const welcomeOk = document.getElementById('welcome-ok');

  function showWelcome() {
    if (localStorage.getItem('echocat-welcome-dismissed')) return;
    welcomeOverlay.classList.remove('hidden');
  }

  welcomeOk.addEventListener('click', () => {
    if (welcomeHide.checked) {
      localStorage.setItem('echocat-welcome-dismissed', '1');
    }
    welcomeOverlay.classList.add('hidden');
  });

  // --- Rig Selector ---
  function updateRigSelect(rigs, activeRigId) {
    if (!rigs || rigs.length < 2) {
      rigBar.classList.add('hidden');
      return;
    }
    rigSelect.innerHTML = rigs.map(r =>
      `<option value="${esc(r.id)}"${r.id === activeRigId ? ' selected' : ''}>${esc(r.name || 'Unnamed Rig')}</option>`
    ).join('');
    rigBar.classList.remove('hidden');
  }

  rigSelect.addEventListener('change', () => {
    const rigId = rigSelect.value;
    if (!rigId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'switch-rig', rigId }));
  });

  // Auto-connect on page load — if server doesn't require a token,
  // it sends auth-ok immediately and we skip the token screen
  connect('');
})();

/**
 * HYPERTRACK PRO INTEL - CLIENT ENGINE (V2.0)
 * Real-time Hyperliquid Top 50 Leaderboard, 5x WebSocket Stream,
 * Noise Filter Engine (OR Logic: Macro 27+ / Flash 8+ / Conviction >$50k & >5% Equity),
 * Consensus Cluster Radar, and Copy Trading Command Center.
 */

// ==========================================================================
// CONFIGURATION & CONSTANTS
// ==========================================================================
const CONFIG = {
  LEADERBOARD_URL: 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard',
  INFO_API_URL: 'https://api.hyperliquid.xyz/info',
  WS_URL: 'wss://api.hyperliquid.xyz/ws',
  EXPLORER_BASE: 'https://app.hyperliquid.xyz/explorer/tx/',
  PORTFOLIO_BASE: 'https://app.hyperliquid.xyz/trade?account=',
  MAX_FEED_ITEMS: 200,
  PING_INTERVAL_MS: 25000,
  POLL_REFRESH_MS: 60000,
  MAX_USERS_PER_SOCKET: 10,
  TARGET_LEADERBOARD_COUNT: 50
};

// ==========================================================================
// NOISE FILTER CONFIGURATION (OR LOGIC)
// ==========================================================================
const DEFAULT_NOISE_FILTER = {
  enabled: true,                   // Enabled by default as requested
  macroConsensusThreshold: 27,     // ≥27 traders in same coin & direction (60-120m)
  macroWindowMinutes: 120,         // 120 minute window
  flashMomentumThreshold: 8,       // ≥8 traders in same coin & direction (15-30m)
  flashWindowMinutes: 30,          // 30 minute window
  minNotionalUSD: 50000,           // Minimum $50,000 USD to eliminate bait
  minEquityWeightPct: 5.0,         // ≥5% of trader's total account equity
  excludeScalpsUnderMin: 3,        // Ignore scalps < 3 minutes
  excludeDeltaNeutral: true        // Exclude obvious delta-neutral / basis hedges
};

// ==========================================================================
// APPLICATION STATE
// ==========================================================================
const state = {
  leaderboard: [],                 // Full parsed leaderboard
  top50: [],                       // Top 50 traders
  previousTop50Addresses: [],      // For reshuffle detection
  trackedTraders: new Set(),       // Set of addresses being monitored
  sockets: [],                     // 5 active WebSocket instances
  soundEnabled: true,
  currentSort: 'day',
  feedItems: [],                   // Live trade stream items
  clusterTradeLog: [],             // Rolling log of fills for consensus detection
  assetStats: {},                  // Aggregate volume & trade statistics
  activePositions: {},             // { address: [positions...] }
  selectedTrader: null,
  showFilteredNoise: false,        // If false, only passed trades appear
  filterStats: {
    passed: 0,
    noise: 0
  },
  noiseFilter: { ...DEFAULT_NOISE_FILTER },
  sim: {
    enabled: false,
    balance: 10000.0,
    startBalance: 10000.0,
    pnl: 0.0,
    trades: []
  }
};

// ==========================================================================
// LOCAL STORAGE PERSISTENCE
// ==========================================================================
function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('hypertrack_noise_filter_v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.noiseFilter = { ...DEFAULT_NOISE_FILTER, ...parsed };
      console.log('[*] Loaded Noise Filter settings from localStorage:', state.noiseFilter);
    }
  } catch (e) {
    console.warn('Could not load settings from localStorage:', e);
  }
}

function saveNoiseFilterSettings() {
  try {
    localStorage.setItem('hypertrack_noise_filter_v2', JSON.stringify(state.noiseFilter));
    console.log('[*] Saved Noise Filter settings to localStorage.');
  } catch (e) {
    console.warn('Could not save settings to localStorage:', e);
  }
}

// ==========================================================================
// SERVICE WORKER REGISTRATION (PERSISTENT BACKGROUND NOTIFICATIONS)
// ==========================================================================
let serviceWorkerReg = null;

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      serviceWorkerReg = await navigator.serviceWorker.register('./sw.js');
      console.log('[*] Service Worker registered successfully for background notifications.');
    } catch (err) {
      console.warn('Service Worker registration failed:', err);
    }
  }
}

function sendSmartNotification(title, body, tag = 'smart-money') {
  // 1. Desktop Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    if (serviceWorkerReg && serviceWorkerReg.active) {
      serviceWorkerReg.active.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body,
        data: { tag }
      });
    } else {
      new Notification(title, {
        body,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%2300F5A0"/></svg>'
      });
    }
  }
}

// ==========================================================================
// AUDIO SYNTHESIZER (WEB AUDIO API)
// ==========================================================================
class SoundEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTradeChime(isLong = true, isWhale = false, isConsensus = false) {
    if (!state.soundEnabled) return;
    try {
      this.init();
      const now = this.ctx.currentTime;

      if (isConsensus) {
        // High Alert: Harmonic Four-Tone Consensus Fanfare
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
          this.playTone(freq, now + (idx * 0.09), 0.35, 'triangle');
        });
      } else if (isWhale) {
        // Whale Alert: Triple Ascending Fanfare
        [587.33, 739.99, 880.00].forEach((freq, idx) => {
          this.playTone(freq, now + (idx * 0.12), 0.35, 'triangle');
        });
      } else if (isLong) {
        // Long Chime: Ascending Two-Tone
        this.playTone(659.25, now, 0.22, 'sine');
        this.playTone(830.61, now + 0.1, 0.26, 'sine');
      } else {
        // Short Chime: Descending Two-Tone
        this.playTone(830.61, now, 0.22, 'sine');
        this.playTone(659.25, now + 0.1, 0.26, 'sine');
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  playTone(frequency, startTime, duration, type = 'sine') {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }
}

const soundEngine = new SoundEngine();

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(title, msg, type = 'long') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ==========================================================================
// LEADERBOARD LOADER: TOP 50 & RESHUFFLE DETECTOR
// ==========================================================================
async function fetchLeaderboard() {
  const updateStatus = (text) => {
    const el = document.getElementById('ws-status-text');
    if (el) el.textContent = text;
  };

  try {
    updateStatus('FETCHING TOP 50 LEADERBOARD...');

    // Request the first 120KB which comfortably returns the top 130+ traders in <150ms
    let text = '';
    try {
      const response = await fetch(CONFIG.LEADERBOARD_URL, {
        headers: { 'Range': 'bytes=0-125000' }
      });
      text = await response.text();
    } catch (rangeErr) {
      const streamRes = await fetch(CONFIG.LEADERBOARD_URL);
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      while (text.length < 125000) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
    }

    const lastBrace = text.lastIndexOf('},');
    if (lastBrace === -1) throw new Error('Invalid JSON slice received');

    const validJsonStr = text.substring(0, lastBrace + 1) + ']}';
    const parsed = JSON.parse(validJsonStr);
    const rows = parsed.leaderboardRows || [];

    if (rows.length === 0) throw new Error('No rows found in leaderboard response');

    // Parse all rows
    state.leaderboard = rows.map((r, idx) => {
      const wins = {};
      (r.windowPerformances || []).forEach(w => {
        wins[w[0]] = w[1];
      });

      return {
        initialRank: idx + 1,
        address: r.ethAddress.toLowerCase(),
        displayName: r.displayName || null,
        accountValue: parseFloat(r.accountValue || 0),
        day: wins.day || { pnl: '0', roi: '0', vlm: '0' },
        week: wins.week || { pnl: '0', roi: '0', vlm: '0' },
        month: wins.month || { pnl: '0', roi: '0', vlm: '0' },
        allTime: wins.allTime || { pnl: '0', roi: '0', vlm: '0' }
      };
    });

    // Sort and isolate Top 50
    sortAndFilterLeaderboard();

    // Reshuffle detection
    detectLeaderboardReshuffle();

    renderLeaderboard();
    updateIntelStrip();
    populateCalculatorDropdown();

    // Start tracking all Top 50 addresses across 5 WebSockets
    state.trackedTraders.clear();
    state.top50.forEach(t => state.trackedTraders.add(t.address));

    initWebSockets();
    scanActivePositions();

    updateStatus('L1 CONNECTED // 5 SOCKETS STREAMING');
    const dot = document.querySelector('.status-dot');
    if (dot) dot.classList.add('active');

  } catch (err) {
    console.error('Failed to load leaderboard:', err);
    updateStatus('L1 RETRYING...');
    showToast('Network Sync', 'Failed to fetch leaderboard. Retrying in 5s...', 'short');
    setTimeout(fetchLeaderboard, 5000);
  }
}

function sortAndFilterLeaderboard() {
  const sortKey = state.currentSort;

  state.leaderboard.sort((a, b) => {
    if (sortKey === 'accountValue') {
      return b.accountValue - a.accountValue;
    }
    const pnlA = parseFloat(a[sortKey]?.pnl || 0);
    const pnlB = parseFloat(b[sortKey]?.pnl || 0);
    return pnlB - pnlA;
  });

  state.top50 = state.leaderboard.slice(0, CONFIG.TARGET_LEADERBOARD_COUNT);
}

function detectLeaderboardReshuffle() {
  const currentAddresses = state.top50.map(t => t.address);

  if (state.previousTop50Addresses.length > 0) {
    const prevSet = new Set(state.previousTop50Addresses);
    const newEntrants = state.top50.filter(t => !prevSet.has(t.address));

    if (newEntrants.length > 0) {
      newEntrants.forEach(t => {
        const short = `${t.address.slice(0, 6)}...${t.address.slice(-4)}`;
        showToast(
          '🏆 Leaderboard Reshuffled',
          `${t.displayName || short} entered the Top 50 (Equity: $${formatNumber(t.accountValue)})`,
          'long'
        );
      });
      console.log(`[*] Leaderboard reshuffle detected: ${newEntrants.length} new traders entered Top 50.`);
    }
  }

  state.previousTop50Addresses = currentAddresses;
}

// ==========================================================================
// RENDER TOP 50 LEADERBOARD TABLE
// ==========================================================================
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;

  if (state.top50.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-state">No leaderboard data found.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.top50.map((trader, i) => {
    const rank = i + 1;
    const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-default';
    const isTracked = state.trackedTraders.has(trader.address);

    const perf = trader[state.currentSort] || {};
    const pnl = parseFloat(perf.pnl || 0);
    const roi = parseFloat(perf.roi || 0) * 100;
    const vlm = parseFloat(perf.vlm || 0);

    const pnlClass = pnl >= 0 ? 'text-green' : 'text-red';
    const pnlSign = pnl >= 0 ? '+' : '';
    const roiSign = roi >= 0 ? '+' : '';

    const shortAddr = `${trader.address.slice(0, 6)}...${trader.address.slice(-4)}`;
    const avatarLetter = (trader.displayName ? trader.displayName[0] : trader.address[2] || 'T').toUpperCase();

    const activePosCount = state.activePositions[trader.address]?.length || 0;

    return `
      <tr data-address="${trader.address}">
        <td><span class="rank-badge ${rankClass}">#${rank}</span></td>
        <td>
          <div class="trader-cell">
            <div class="trader-avatar">${avatarLetter}</div>
            <div class="trader-info-block">
              <span class="trader-name">
                ${trader.displayName || shortAddr}
                <a href="${CONFIG.PORTFOLIO_BASE}${trader.address}" target="_blank" rel="noopener" title="Open on Hyperliquid" style="color:var(--neon-cyan);text-decoration:none;font-size:0.75rem;">↗</a>
              </span>
              <span class="trader-addr">${shortAddr}</span>
            </div>
          </div>
        </td>
        <td class="text-right font-bold">$${formatNumber(trader.accountValue)}</td>
        <td class="text-right ${pnlClass} font-bold">${pnlSign}$${formatNumber(pnl)}</td>
        <td class="text-right ${pnlClass}">${roiSign}${roi.toFixed(2)}%</td>
        <td class="text-right text-muted">$${formatNumber(vlm)}</td>
        <td class="text-center">
          <span class="tab-badge" style="cursor:pointer;" onclick="openTraderModal('${trader.address}')">
            ${activePosCount > 0 ? `🔥 ${activePosCount} open` : 'None'}
          </span>
        </td>
        <td class="text-center">
          <input type="checkbox" ${isTracked ? 'checked' : ''} onchange="toggleTrackTrader('${trader.address}', this.checked)" title="Track in live WebSocket stream">
        </td>
        <td class="text-center">
          <button class="btn-inspect" onclick="openTraderModal('${trader.address}')">Inspect</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateIntelStrip() {
  const totalEquity = state.top50.reduce((acc, t) => acc + t.accountValue, 0);
  const total24hPnl = state.top50.reduce((acc, t) => acc + parseFloat(t.day?.pnl || 0), 0);
  const total24hVlm = state.top50.reduce((acc, t) => acc + parseFloat(t.day?.vlm || 0), 0);

  const eqEl = document.getElementById('intel-total-equity');
  const pnlEl = document.getElementById('intel-total-pnl');
  const vlmEl = document.getElementById('intel-total-vlm');

  if (eqEl) eqEl.textContent = `$${formatNumber(totalEquity)}`;
  if (pnlEl) {
    pnlEl.textContent = `${total24hPnl >= 0 ? '+' : ''}$${formatNumber(total24hPnl)}`;
    pnlEl.className = `intel-val ${total24hPnl >= 0 ? 'text-green' : 'text-red'}`;
  }
  if (vlmEl) vlmEl.textContent = `24h Vol: $${formatNumber(total24hVlm)}`;

  updateNoiseFilterStatsUI();
}

function updateNoiseFilterStatsUI() {
  const statusEl = document.getElementById('intel-filter-status');
  const statsEl = document.getElementById('intel-filter-stats');
  const tallyEl = document.getElementById('filter-tally');

  if (statusEl) {
    statusEl.textContent = state.noiseFilter.enabled ? 'FILTER: ACTIVE (DEFAULT)' : 'FILTER: OFF (RAW)';
    statusEl.className = `intel-val ${state.noiseFilter.enabled ? 'text-green' : 'text-gold'}`;
  }
  const summaryStr = `${state.filterStats.passed} Passed • ${state.filterStats.noise} Noise Filtered`;
  if (statsEl) statsEl.textContent = summaryStr;
  if (tallyEl) tallyEl.textContent = summaryStr;
}

// ==========================================================================
// ACTIVE POSITIONS SCANNER (INFO API)
// ==========================================================================
async function scanActivePositions() {
  let totalLongUSD = 0;
  let totalShortUSD = 0;

  // Query clearinghouse states for top 15 traders
  const targets = state.top50.slice(0, 15);

  for (const t of targets) {
    try {
      const res = await fetch(CONFIG.INFO_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: t.address })
      });
      const data = await res.json();
      const positions = data.assetPositions || [];
      state.activePositions[t.address] = positions;

      positions.forEach(p => {
        const pos = p.position;
        const szi = parseFloat(pos.szi || 0);
        const entryPx = parseFloat(pos.entryPx || 0);
        const notional = Math.abs(szi * entryPx);

        if (szi > 0) totalLongUSD += notional;
        else if (szi < 0) totalShortUSD += notional;

        const coin = pos.coin;
        if (!state.assetStats[coin]) {
          state.assetStats[coin] = { volume: 0, trades: 0, longs: 0, shorts: 0, pnl: 0 };
        }
        if (szi > 0) state.assetStats[coin].longs += notional;
        else state.assetStats[coin].shorts += notional;
      });
    } catch (e) {
      console.warn(`Error scanning positions for ${t.address}:`, e);
    }
  }

  // Update Sentiment Bar
  const total = totalLongUSD + totalShortUSD;
  if (total > 0) {
    const longPct = (totalLongUSD / total) * 100;
    const shortPct = (totalShortUSD / total) * 100;

    const longBar = document.getElementById('sentiment-long-bar');
    const shortBar = document.getElementById('sentiment-short-bar');
    const longLbl = document.getElementById('bias-long-pct');
    const shortLbl = document.getElementById('bias-short-pct');
    const statusLbl = document.getElementById('bias-status');

    if (longBar) longBar.style.width = `${longPct}%`;
    if (shortBar) shortBar.style.width = `${shortPct}%`;
    if (longLbl) longLbl.textContent = `${longPct.toFixed(1)}% Long ($${formatNumber(totalLongUSD)})`;
    if (shortLbl) shortLbl.textContent = `${shortPct.toFixed(1)}% Short ($${formatNumber(totalShortUSD)})`;
    if (statusLbl) {
      statusLbl.textContent = longPct > 55 ? 'Net Bullish Smart Money Accumulation' : shortPct > 55 ? 'Net Bearish Smart Money Distribution' : 'Balanced Market Neutral Bias';
    }
  }

  renderAssetAnalytics();
  renderLeaderboard();
  renderConsensusRadar();
}

// ==========================================================================
// 5X WEBSOCKET CONNECTIONS (SCALED FOR TOP 50 TRADERS)
// ==========================================================================
function initWebSockets() {
  state.sockets.forEach(ws => {
    try { ws.close(); } catch (_) {}
  });
  state.sockets = [];

  const addresses = Array.from(state.trackedTraders);
  if (addresses.length === 0) return;

  // Hyperliquid max 10 users per WS connection: 50 traders = 5 connections
  const chunks = [];
  for (let i = 0; i < addresses.length; i += CONFIG.MAX_USERS_PER_SOCKET) {
    chunks.push(addresses.slice(i, i + CONFIG.MAX_USERS_PER_SOCKET));
  }

  chunks.forEach((chunk, index) => {
    connectWebSocketChunk(chunk, index + 1);
  });
}

function connectWebSocketChunk(userList, socketIndex) {
  try {
    const ws = new WebSocket(CONFIG.WS_URL);
    state.sockets.push(ws);

    let pingInterval = null;

    ws.onopen = () => {
      console.log(`[Socket #${socketIndex}/5] Connected. Subscribing to ${userList.length} traders...`);

      userList.forEach(user => {
        ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'userFills', user }
        }));
        ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'orderUpdates', user }
        }));
      });

      // Keepalive Ping
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const start = Date.now();
          ws.send(JSON.stringify({ method: 'ping' }));
          ws._lastPing = start;
        }
      }, CONFIG.PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.channel === 'pong') {
          if (ws._lastPing) {
            const latency = Date.now() - ws._lastPing;
            const pingEl = document.getElementById('ws-ping');
            if (pingEl) pingEl.textContent = `${latency}ms`;
          }
          return;
        }

        if (msg.channel === 'userFills') {
          handleIncomingFills(msg.data);
        } else if (msg.channel === 'orderUpdates') {
          handleIncomingOrders(msg.data);
        }
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn(`WebSocket #${socketIndex} error:`, err);
    };

    ws.onclose = () => {
      console.log(`WebSocket #${socketIndex} closed. Reconnecting in 4s...`);
      clearInterval(pingInterval);
      setTimeout(() => connectWebSocketChunk(userList, socketIndex), 4000);
    };

  } catch (err) {
    console.error('Failed to create WebSocket:', err);
  }
}

// ==========================================================================
// NOISE FILTER LOGIC (OR LOGICAL EVALUATION ENGINE)
// ==========================================================================
/**
 * Evaluates an incoming trade against the 3 high-conviction criteria using OR logic:
 * - Rule 1: Macro Consensus Clustering (≥27 traders in 60-120m)
 * - Rule 2: Flash Momentum Clustering (≥8 traders in 15-30m)
 * - Rule 3: High-Conviction Whale Execution (≥$50k USD AND ≥5% account equity AND anti-scalp AND anti-hedge)
 */
function evaluateNoiseFilter(fillItem, traderEquity) {
  const f = state.noiseFilter;

  // Default: if filter is disabled, all trades pass
  if (!f.enabled) {
    return {
      passed: true,
      reason: 'FILTER_DISABLED',
      badge: 'RAW STREAM'
    };
  }

  const now = fillItem.time || Date.now();
  const coin = fillItem.coin;
  const isLong = fillItem.dir.includes('Long') || fillItem.side === 'B';
  const normDir = isLong ? 'LONG' : 'SHORT';

  // 1. Check Delta-Neutral Hedging (if enabled)
  if (f.excludeDeltaNeutral) {
    // Check if the trader recently executed an opposing trade in this coin within 3 minutes
    const recentOpposite = state.clusterTradeLog.find(t => 
      t.user.toLowerCase() === fillItem.user.toLowerCase() &&
      t.coin === coin &&
      t.normDir !== normDir &&
      (now - t.time) < 180000
    );
    if (recentOpposite) {
      return {
        passed: false,
        reason: 'DELTA_NEUTRAL_HEDGE',
        badge: 'HEDGE / NOISE'
      };
    }
  }

  // 2. Rule 2: FLASH MOMENTUM CLUSTERING (OR Logical Condition #1)
  // Window: flashWindowMinutes (e.g. 30m)
  const flashWindowMs = f.flashWindowMinutes * 60 * 1000;
  const flashTraders = new Set();
  flashTraders.add(fillItem.user.toLowerCase());

  state.clusterTradeLog.forEach(t => {
    if (t.coin === coin && t.normDir === normDir && (now - t.time) <= flashWindowMs) {
      flashTraders.add(t.user.toLowerCase());
    }
  });

  if (flashTraders.size >= f.flashMomentumThreshold) {
    return {
      passed: true,
      reason: 'FLASH_MOMENTUM_CLUSTER',
      badge: `⚡ FLASH: ${flashTraders.size}/${f.flashMomentumThreshold} TRADERS`,
      clusterCount: flashTraders.size
    };
  }

  // 3. Rule 1: MACRO CONSENSUS CLUSTERING (OR Logical Condition #2)
  // Window: macroWindowMinutes (e.g. 120m)
  const macroWindowMs = f.macroWindowMinutes * 60 * 1000;
  const macroTraders = new Set();
  macroTraders.add(fillItem.user.toLowerCase());

  state.clusterTradeLog.forEach(t => {
    if (t.coin === coin && t.normDir === normDir && (now - t.time) <= macroWindowMs) {
      macroTraders.add(t.user.toLowerCase());
    }
  });

  if (macroTraders.size >= f.macroConsensusThreshold) {
    return {
      passed: true,
      reason: 'MACRO_CONSENSUS_CLUSTER',
      badge: `🏛️ MACRO: ${macroTraders.size}/${f.macroConsensusThreshold} TRADERS`,
      clusterCount: macroTraders.size
    };
  }

  // 4. Rule 3: HIGH CONVICTION EXECUTION & ANTI-SCALP (OR Logical Condition #3)
  // Check Notional Size (≥$50,000 USD)
  const sizeSatisfied = fillItem.notionalUSD >= f.minNotionalUSD;

  // Check Account Margin Weight (≥5% of total equity)
  let equityWeightPct = 0;
  if (traderEquity > 0) {
    equityWeightPct = (fillItem.notionalUSD / traderEquity) * 100;
  }
  const weightSatisfied = equityWeightPct >= f.minEquityWeightPct;

  // Check Ultra-Short Scalp exclusion (exclude trades < 3-5m duration)
  let isUltraScalp = false;
  if (f.excludeScalpsUnderMin > 0) {
    const priorFill = state.clusterTradeLog.find(t =>
      t.user.toLowerCase() === fillItem.user.toLowerCase() &&
      t.coin === coin &&
      (now - t.time) < (f.excludeScalpsUnderMin * 60 * 1000)
    );
    if (priorFill) isUltraScalp = true;
  }

  if (sizeSatisfied && weightSatisfied && !isUltraScalp) {
    return {
      passed: true,
      reason: 'HIGH_CONVICTION_EXECUTION',
      badge: `🐋 CONVICTION (${equityWeightPct.toFixed(1)}% EQUITY)`,
      equityWeightPct
    };
  }

  // If none of the 3 OR conditions were met, trade is filtered as noise
  return {
    passed: false,
    reason: 'FILTERED_NOISE_OR_SCALP',
    badge: 'NOISE / BAIT'
  };
}

// ==========================================================================
// FILL & ORDER PROCESSING
// ==========================================================================
function handleIncomingFills(data) {
  if (!data || !data.fills) return;
  const isSnapshot = data.isSnapshot === true;
  const fills = data.fills;

  fills.forEach(fill => {
    const coin = fill.coin;
    const px = parseFloat(fill.px || 0);
    const sz = parseFloat(fill.sz || 0);
    const notionalUSD = px * sz;
    const dir = fill.dir || (fill.side === 'B' ? 'Buy' : 'Sell');
    const closedPnl = parseFloat(fill.closedPnl || 0);
    const time = fill.time || Date.now();
    const hash = fill.hash || '';
    const user = (data.user || fill.user || '').toLowerCase();

    // Look up trader equity
    const traderObj = state.top50.find(t => t.address === user) || state.leaderboard.find(t => t.address === user);
    const traderEquity = traderObj ? traderObj.accountValue : 0;
    const isLong = dir.includes('Long') || fill.side === 'B';
    const normDir = isLong ? 'LONG' : 'SHORT';

    const fillItem = {
      coin,
      px,
      sz,
      notionalUSD,
      dir,
      normDir,
      closedPnl,
      time,
      hash,
      user,
      oid: fill.oid,
      displayName: traderObj?.displayName || null
    };

    // Record in rolling cluster log
    state.clusterTradeLog.push(fillItem);
    // Keep cluster log within last 4 hours
    const fourHoursAgo = Date.now() - (4 * 3600 * 1000);
    if (state.clusterTradeLog.length > 2000) {
      state.clusterTradeLog = state.clusterTradeLog.filter(t => t.time > fourHoursAgo);
    }

    // Evaluate Noise Filter
    const filterVerdict = evaluateNoiseFilter(fillItem, traderEquity);
    fillItem.filterVerdict = filterVerdict;

    if (filterVerdict.passed) {
      state.filterStats.passed++;
    } else {
      state.filterStats.noise++;
    }

    // Update aggregate asset stats
    if (!state.assetStats[coin]) {
      state.assetStats[coin] = { volume: 0, trades: 0, longs: 0, shorts: 0, pnl: 0 };
    }
    state.assetStats[coin].volume += notionalUSD;
    state.assetStats[coin].trades += 1;
    state.assetStats[coin].pnl += closedPnl;
    if (isLong) state.assetStats[coin].longs += notionalUSD;
    else state.assetStats[coin].shorts += notionalUSD;

    // Real-time live execution events
    if (!isSnapshot) {
      if (filterVerdict.passed) {
        const isConsensus = filterVerdict.reason.includes('CLUSTER');
        const isWhale = notionalUSD >= 50000;

        // Audio notification
        soundEngine.playTradeChime(isLong, isWhale, isConsensus);

        // Toast alert
        const shortAddr = fillItem.displayName || (user.length > 10 ? `${user.slice(0, 6)}...` : user);
        showToast(
          `${filterVerdict.badge} // ${dir.toUpperCase()} on ${coin}`,
          `${shortAddr} filled ${sz.toFixed(4)} ${coin} at $${px.toLocaleString()} ($${formatNumber(notionalUSD)})`,
          isLong ? 'long' : 'short'
        );

        // Background Desktop / Service Worker Notification
        sendSmartNotification(
          `HyperTrack [${filterVerdict.badge}]: ${dir} ${coin}`,
          `Trader ${shortAddr} • $${formatNumber(notionalUSD)} @ $${px.toLocaleString()}`
        );

        // Simulator replication
        processSimulatedCopy(fillItem);
      }
    }

    state.feedItems.unshift(fillItem);
    if (state.feedItems.length > CONFIG.MAX_FEED_ITEMS) {
      state.feedItems.pop();
    }
  });

  renderFeedCards();
  updateLiveFeedStats();
  updateNoiseFilterStatsUI();
  renderConsensusRadar();
}

function handleIncomingOrders(data) {
  renderSidebarOrders(data);
}

// ==========================================================================
// RENDER LIVE FEED (WITH NOISE FILTER APPLIED)
// ==========================================================================
function renderFeedCards() {
  const container = document.getElementById('feed-cards-container');
  if (!container) return;

  const assetFilter = document.getElementById('filter-feed-asset')?.value || 'ALL';
  const sizeFilter = parseFloat(document.getElementById('filter-feed-size')?.value || 0);
  const showNoise = state.showFilteredNoise;

  const filtered = state.feedItems.filter(item => {
    if (assetFilter !== 'ALL' && item.coin !== assetFilter) return false;
    if (sizeFilter > 0 && item.notionalUSD < sizeFilter) return false;
    // Apply Noise Filter: if filter is enabled and showNoise is false, hide filtered-out trades
    if (state.noiseFilter.enabled && !showNoise && !item.filterVerdict.passed) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    if (state.feedItems.length === 0) {
      container.innerHTML = `
        <div class="empty-feed">
          <div class="radar-scan"></div>
          <p>Listening to Hyperliquid Mainnet 5x WebSockets (<code>${CONFIG.WS_URL}</code>)...</p>
          <span class="subtext">Trades fulfilling the <strong>Noise Filter</strong> criteria will trigger audio alerts and stream here in real time.</span>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-feed">
          <p>All recent trades were filtered out by the <strong>Noise Filter</strong>.</p>
          <span class="subtext">Only trades passing the OR criteria (27+ Macro / 8+ Flash / &gt;$50K &gt;5% Equity) will appear here.</span>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = filtered.slice(0, 60).map(item => {
    let actionBadgeClass = 'badge-action';
    let cardClass = 'feed-card';

    if (item.dir.includes('Open Long')) {
      actionBadgeClass += ' badge-open-long';
      cardClass += ' action-open-long';
    } else if (item.dir.includes('Open Short')) {
      actionBadgeClass += ' badge-open-short';
      cardClass += ' action-open-short';
    } else if (item.dir.includes('Close Long')) {
      actionBadgeClass += ' badge-close-long';
      cardClass += ' action-close-long';
    } else if (item.dir.includes('Close Short')) {
      actionBadgeClass += ' badge-close-short';
      cardClass += ' action-close-short';
    } else {
      actionBadgeClass += ' badge-trigger';
    }

    // Filter badge styling
    let filterTagHtml = '';
    if (item.filterVerdict.passed) {
      if (item.filterVerdict.reason === 'FLASH_MOMENTUM_CLUSTER') {
        filterTagHtml = `<span class="badge-filter-tag badge-flash-cluster">${item.filterVerdict.badge}</span>`;
      } else if (item.filterVerdict.reason === 'MACRO_CONSENSUS_CLUSTER') {
        filterTagHtml = `<span class="badge-filter-tag badge-macro-cluster">${item.filterVerdict.badge}</span>`;
      } else if (item.filterVerdict.reason === 'HIGH_CONVICTION_EXECUTION') {
        filterTagHtml = `<span class="badge-filter-tag badge-conviction">${item.filterVerdict.badge}</span>`;
      }
    } else {
      cardClass += ' noise-card';
      filterTagHtml = `<span class="badge-filter-tag badge-filtered-noise">FILTERED NOISE</span>`;
    }

    const shortAddr = item.displayName || (item.user.length > 10 ? `${item.user.slice(0, 6)}...${item.user.slice(-4)}` : item.user);
    const timeAgo = formatTimeAgo(item.time);
    const pnlSign = item.closedPnl >= 0 ? '+' : '';
    const pnlColor = item.closedPnl >= 0 ? 'text-green' : 'text-red';

    return `
      <div class="${cardClass}">
        <div>
          <span class="${actionBadgeClass}">${item.dir.toUpperCase()}</span>
          ${filterTagHtml}
        </div>

        <div class="feed-coin-badge">
          <span>${item.coin}</span>
        </div>

        <div class="feed-details">
          <div class="feed-main-row">
            <span>Price: <strong>$${formatNumber(item.px)}</strong></span>
            <span>Size: <strong>${item.sz.toFixed(4)} ${item.coin}</strong> ($${formatNumber(item.notionalUSD)})</span>
          </div>
          <div class="feed-sub-row">
            <span>Trader: <strong style="color:var(--text-main);cursor:pointer;" onclick="openTraderModal('${item.user}')">${shortAddr}</strong></span>
            ${item.hash ? `• <a href="${CONFIG.EXPLORER_BASE}${item.hash}" target="_blank" rel="noopener" style="color:var(--neon-cyan);text-decoration:none;">Tx ↗</a>` : ''}
          </div>
        </div>

        <div class="feed-right-col">
          <span class="feed-time">${timeAgo}</span>
          ${item.closedPnl !== 0 ? `<span class="feed-pnl ${pnlColor}">${pnlSign}$${formatNumber(item.closedPnl)} PnL</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const autoScroll = document.getElementById('chk-autoscroll')?.checked;
  if (autoScroll) {
    container.scrollTop = 0;
  }
}

function updateLiveFeedStats() {
  const countEl = document.getElementById('live-trade-count');
  const timeEl = document.getElementById('last-trade-time');
  const rateEl = document.getElementById('stream-rate');

  if (countEl) countEl.textContent = `${state.feedItems.length} Fills`;
  if (timeEl && state.feedItems[0]) {
    timeEl.textContent = `Latest: ${formatTimeAgo(state.feedItems[0].time)}`;
  }
  if (rateEl) {
    const now = Date.now();
    const recent = state.feedItems.filter(f => now - f.time < 60000).length;
    rateEl.textContent = `${recent} fills / min`;
  }
}

// ==========================================================================
// CONSENSUS CLUSTER RADAR (ASSET TENDENCY TAB)
// ==========================================================================
function renderConsensusRadar() {
  const container = document.getElementById('consensus-cards-container');
  if (!container) return;

  const now = Date.now();
  const f = state.noiseFilter;
  const flashWindowMs = f.flashWindowMinutes * 60 * 1000;
  const macroWindowMs = f.macroWindowMinutes * 60 * 1000;

  // Track unique traders per coin and direction
  const clusterMap = {}; // { 'BTC-LONG': { coin: 'BTC', dir: 'LONG', flashTraders: Set, macroTraders: Set } }

  state.clusterTradeLog.forEach(t => {
    const key = `${t.coin}-${t.normDir}`;
    if (!clusterMap[key]) {
      clusterMap[key] = {
        coin: t.coin,
        dir: t.normDir,
        flashTraders: new Set(),
        macroTraders: new Set()
      };
    }

    if ((now - t.time) <= flashWindowMs) {
      clusterMap[key].flashTraders.add(t.user.toLowerCase());
    }
    if ((now - t.time) <= macroWindowMs) {
      clusterMap[key].macroTraders.add(t.user.toLowerCase());
    }
  });

  const clusterList = Object.values(clusterMap);
  if (clusterList.length === 0) {
    container.innerHTML = `
      <div class="loading-state mini">
        <span>No consensus clusters active in the rolling window yet. Watching Top 50 execution streams...</span>
      </div>
    `;
    return;
  }

  // Sort by highest consensus count
  clusterList.sort((a, b) => (b.flashTraders.size + b.macroTraders.size) - (a.flashTraders.size + a.macroTraders.size));

  container.innerHTML = clusterList.slice(0, 6).map(c => {
    const flashCount = c.flashTraders.size;
    const macroCount = c.macroTraders.size;
    const flashThreshold = f.flashMomentumThreshold;
    const macroThreshold = f.macroConsensusThreshold;

    const flashPct = Math.min((flashCount / flashThreshold) * 100, 100);
    const macroPct = Math.min((macroCount / macroThreshold) * 100, 100);

    const isFlashTriggered = flashCount >= flashThreshold;
    const isMacroTriggered = macroCount >= macroThreshold;
    const isTriggered = isFlashTriggered || isMacroTriggered;

    let statusPill = `<span class="consensus-status-pill" style="background:rgba(255,255,255,0.08);color:var(--text-muted);">BUILDING (${flashCount}/${flashThreshold})</span>`;
    if (isMacroTriggered) {
      statusPill = `<span class="consensus-status-pill" style="background:rgba(255,183,3,0.25);color:var(--neon-gold);border:1px solid var(--neon-gold);">🏛️ MACRO CONSENSUS TRIGGERED</span>`;
    } else if (isFlashTriggered) {
      statusPill = `<span class="consensus-status-pill" style="background:rgba(0,245,160,0.25);color:var(--neon-green);border:1px solid var(--neon-green);">⚡ FLASH MOMENTUM TRIGGERED</span>`;
    }

    const dirClass = c.dir === 'LONG' ? 'text-green' : 'text-red';

    return `
      <div class="consensus-card ${isTriggered ? 'triggered' : ''}">
        <div class="consensus-card-header">
          <div class="consensus-asset-name">
            <strong>${c.coin}</strong>
            <span class="${dirClass}">${c.dir}</span>
          </div>
          ${statusPill}
        </div>

        <!-- Flash Meter (15-30m) -->
        <div class="consensus-meter">
          <div class="consensus-meter-label">
            <span>⚡ Flash Cluster (${f.flashWindowMinutes}m Window):</span>
            <strong>${flashCount} / ${flashThreshold} Traders</strong>
          </div>
          <div class="consensus-meter-track">
            <div class="consensus-meter-fill fill-flash" style="width: ${flashPct}%;"></div>
          </div>
        </div>

        <!-- Macro Meter (60-120m) -->
        <div class="consensus-meter">
          <div class="consensus-meter-label">
            <span>🏛️ Macro Consensus (${f.macroWindowMinutes}m Window):</span>
            <strong>${macroCount} / ${macroThreshold} Traders</strong>
          </div>
          <div class="consensus-meter-track">
            <div class="consensus-meter-fill fill-macro" style="width: ${macroPct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// ASSET PREFERENCE & TENDENCY MATRIX
// ==========================================================================
function renderAssetAnalytics() {
  const volContainer = document.getElementById('asset-volume-breakdown');
  const biasContainer = document.getElementById('asset-bias-breakdown');
  const posContainer = document.getElementById('open-positions-matrix');
  const convictionContainer = document.getElementById('conviction-trades-ledger');
  const styleContainer = document.getElementById('trader-style-matrix');

  if (!volContainer || !biasContainer) return;

  const assets = Object.entries(state.assetStats);
  if (assets.length === 0) return;

  assets.sort((a, b) => b[1].volume - a[1].volume);
  const maxVol = Math.max(...assets.map(a => a[1].volume), 1);

  // 1. Most Traded Assets
  volContainer.innerHTML = assets.slice(0, 6).map(([coin, data]) => {
    const pct = Math.min((data.volume / maxVol) * 100, 100);
    return `
      <div class="asset-stat-row">
        <strong>${coin}</strong>
        <div class="asset-bar-bg">
          <div class="asset-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="text-right text-muted">$${formatNumber(data.volume)}</span>
      </div>
    `;
  }).join('');

  // 2. Directional Bias Per Asset
  biasContainer.innerHTML = assets.slice(0, 6).map(([coin, data]) => {
    const totalExposure = data.longs + data.shorts;
    const longPct = totalExposure > 0 ? (data.longs / totalExposure) * 100 : 50;
    const shortPct = 100 - longPct;
    return `
      <div style="margin-bottom: 12px; font-family: var(--font-mono); font-size: 0.8rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${coin}</strong>
          <span><span class="text-green">${longPct.toFixed(0)}% L</span> / <span class="text-red">${shortPct.toFixed(0)}% S</span></span>
        </div>
        <div class="sentiment-bar" style="height:6px;">
          <div class="sentiment-fill-long" style="width: ${longPct}%;"></div>
          <div class="sentiment-fill-short" style="width: ${shortPct}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  // 3. High Conviction Trade Ledger
  if (convictionContainer) {
    const convictionTrades = state.feedItems.filter(f => f.filterVerdict?.reason === 'HIGH_CONVICTION_EXECUTION');
    if (convictionTrades.length === 0) {
      convictionContainer.innerHTML = `<div class="subtext text-center text-dim" style="padding:16px;">Watching for executions exceeding ≥$50K USD and ≥5% of trader equity...</div>`;
    } else {
      convictionContainer.innerHTML = `
        <div class="table-container mini">
          <table class="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Trader</th>
                <th>Coin</th>
                <th>Action</th>
                <th class="text-right">Price</th>
                <th class="text-right">Notional Size</th>
                <th class="text-right">Trader Equity Staked</th>
                <th class="text-center">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              ${convictionTrades.slice(0, 8).map(ct => {
                const isLong = ct.dir.includes('Long');
                return `
                  <tr>
                    <td class="text-dim">${formatTimeAgo(ct.time)}</td>
                    <td><strong>${ct.displayName || ct.user.slice(0, 6) + '...'}</strong></td>
                    <td><strong>${ct.coin}</strong></td>
                    <td><span class="${isLong ? 'badge-action badge-open-long' : 'badge-action badge-open-short'}">${ct.dir}</span></td>
                    <td class="text-right">$${formatNumber(ct.px)}</td>
                    <td class="text-right text-cyan font-bold">$${formatNumber(ct.notionalUSD)}</td>
                    <td class="text-right text-green font-bold">${ct.filterVerdict.equityWeightPct ? ct.filterVerdict.equityWeightPct.toFixed(1) + '%' : '>5%'}</td>
                    <td class="text-center">${ct.hash ? `<a href="${CONFIG.EXPLORER_BASE}${ct.hash}" target="_blank" rel="noopener" style="color:var(--neon-cyan);text-decoration:none;">View ↗</a>` : '--'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // 4. Open Positions Matrix across Top 50 Traders
  if (posContainer) {
    const allPositions = [];
    Object.entries(state.activePositions).forEach(([user, posArr]) => {
      posArr.forEach(p => {
        allPositions.push({ user, ...p.position });
      });
    });

    if (allPositions.length === 0) {
      posContainer.innerHTML = `<div class="loading-state mini"><span>Scanning active position states across Top 50 traders...</span></div>`;
    } else {
      const coinMap = {};
      allPositions.forEach(p => {
        const coin = p.coin;
        const szi = parseFloat(p.szi || 0);
        const entryPx = parseFloat(p.entryPx || 0);
        const upnl = parseFloat(p.unrealizedPnl || 0);
        if (!coinMap[coin]) coinMap[coin] = { longsUSD: 0, shortsUSD: 0, upnl: 0, count: 0 };
        const notional = Math.abs(szi * entryPx);
        if (szi > 0) coinMap[coin].longsUSD += notional;
        else coinMap[coin].shortsUSD += notional;
        coinMap[coin].upnl += upnl;
        coinMap[coin].count += 1;
      });

      posContainer.innerHTML = `
        <div class="table-container mini">
          <table class="data-table">
            <thead>
              <tr>
                <th>Coin Asset</th>
                <th class="text-right">Top Traders Holding</th>
                <th class="text-right">Total Long Exposure</th>
                <th class="text-right">Total Short Exposure</th>
                <th class="text-right">Net Aggregate Bias</th>
                <th class="text-right">Combined Unrealized PnL</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(coinMap).slice(0, 10).map(([coin, data]) => {
                const net = data.longsUSD - data.shortsUSD;
                const netClass = net >= 0 ? 'text-green' : 'text-red';
                const upnlClass = data.upnl >= 0 ? 'text-green' : 'text-red';
                return `
                  <tr>
                    <td><strong>${coin}</strong></td>
                    <td class="text-right">${data.count} positions</td>
                    <td class="text-right text-green">$${formatNumber(data.longsUSD)}</td>
                    <td class="text-right text-red">$${formatNumber(data.shortsUSD)}</td>
                    <td class="text-right ${netClass}"><strong>${net >= 0 ? 'NET LONG' : 'NET SHORT'} ($${formatNumber(Math.abs(net))})</strong></td>
                    <td class="text-right ${upnlClass}">${data.upnl >= 0 ? '+' : ''}$${formatNumber(data.upnl)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // 5. Execution Style & Hedging Detection
  if (styleContainer) {
    styleContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; font-family: var(--font-mono); font-size: 0.8rem;">
        <div style="background:var(--bg-secondary); padding:14px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--neon-green); font-weight:700; margin-bottom:4px;">⚡ HIGH FREQUENCY SCALPERS (FILTERED)</div>
          <p style="color:var(--text-muted); font-size:0.75rem;">Trades holding for &lt;3 minutes or micro flips are automatically suppressed by the Noise Filter.</p>
        </div>
        <div style="background:var(--bg-secondary); padding:14px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--neon-cyan); font-weight:700; margin-bottom:4px;">📈 MOMENTUM CONSENSUS CLUSTERS</div>
          <p style="color:var(--text-muted); font-size:0.75rem;">Detects when 8+ or 27+ elite traders converge on the same asset simultaneously. Highest statistical conviction.</p>
        </div>
        <div style="background:var(--bg-secondary); padding:14px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--neon-gold); font-weight:700; margin-bottom:4px;">🛡️ DELTA-NEUTRAL BASIS HEDGERS (FILTERED)</div>
          <p style="color:var(--text-muted); font-size:0.75rem;">Traders harvesting funding rates via equal spot Long + perp Short are excluded from directional alerts.</p>
        </div>
      </div>
    `;
  }
}

// ==========================================================================
// COPY TRADING COMMAND & SIZING CALCULATOR
// ==========================================================================
function populateCalculatorDropdown() {
  const select = document.getElementById('calc-leader-select');
  if (!select) return;

  select.innerHTML = state.top50.map((trader, i) => {
    const label = trader.displayName ? `#${i+1} ${trader.displayName}` : `#${i+1} ${trader.address.slice(0, 8)}... (${formatNumber(trader.accountValue)})`;
    return `<option value="${trader.address}">${label}</option>`;
  }).join('');

  updateCalculatorPreview();
}

function updateCalculatorPreview() {
  const select = document.getElementById('calc-leader-select');
  if (!select) return;

  const addr = select.value;
  const trader = state.top50.find(t => t.address === addr.toLowerCase()) || state.top50[0];
  if (!trader) return;

  const eqEl = document.getElementById('prev-leader-equity');
  const pnlEl = document.getElementById('prev-leader-pnl');
  const posEl = document.getElementById('prev-leader-pos');

  if (eqEl) eqEl.textContent = `$${formatNumber(trader.accountValue)}`;
  if (pnlEl) {
    const monthPnl = parseFloat(trader.month?.pnl || 0);
    pnlEl.textContent = `${monthPnl >= 0 ? '+' : ''}$${formatNumber(monthPnl)}`;
    pnlEl.className = `val ${monthPnl >= 0 ? 'text-green' : 'text-red'}`;
  }
  if (posEl) {
    const count = state.activePositions[trader.address]?.length || 0;
    posEl.textContent = `${count} active positions`;
  }

  calculateReplicationSize(trader);
}

function calculateReplicationSize(leader) {
  const copierBalance = parseFloat(document.getElementById('calc-copier-balance')?.value || 2000);
  const maxLev = parseFloat(document.getElementById('calc-max-leverage')?.value || 3);
  const maxAlloc = parseFloat(document.getElementById('calc-max-alloc')?.value || 25);

  const leaderEquity = leader ? leader.accountValue : 50000000;
  const sampleLeaderTradeUSD = Math.max(leaderEquity * 0.02, 100000);
  const weight = (sampleLeaderTradeUSD / leaderEquity);

  let targetSizeUSD = copierBalance * weight;
  const maxAllowed = copierBalance * (maxAlloc / 100);
  if (targetSizeUSD > maxAllowed) targetSizeUSD = maxAllowed;

  const effectiveMargin = targetSizeUSD / maxLev;

  const descEl = document.getElementById('calc-example-desc');
  const sizeEl = document.getElementById('res-copy-size');
  const marginEl = document.getElementById('res-copy-margin');
  const weightEl = document.getElementById('res-copy-weight');

  if (descEl) {
    descEl.innerHTML = `If Leader opens a <strong>$${formatNumber(sampleLeaderTradeUSD)}</strong> position in BTC (approx ${(weight * 100).toFixed(2)}% of their capital):`;
  }
  if (sizeEl) sizeEl.textContent = `$${targetSizeUSD.toFixed(2)} USD`;
  if (marginEl) marginEl.textContent = `$${effectiveMargin.toFixed(2)} (at ${maxLev}x)`;
  if (weightEl) weightEl.textContent = `${(weight * 100).toFixed(2)}%`;
}

// ==========================================================================
// QUICK PAPER COPY SIMULATOR
// ==========================================================================
function processSimulatedCopy(fillItem) {
  const chk = document.getElementById('chk-auto-simulate');
  if (!chk || !chk.checked) return;

  const top1 = state.top50[0];
  if (!top1 || top1.address !== fillItem.user) return;

  const copierBalance = state.sim.balance;
  const weight = fillItem.notionalUSD / top1.accountValue;
  const copySizeUSD = Math.max(copierBalance * weight, 5.0);

  state.sim.trades.push({
    coin: fillItem.coin,
    dir: fillItem.dir,
    px: fillItem.px,
    copySizeUSD,
    time: Date.now()
  });

  if (fillItem.closedPnl !== 0) {
    const leaderPnLPct = fillItem.closedPnl / fillItem.notionalUSD;
    const simPnL = copySizeUSD * leaderPnLPct;
    state.sim.pnl += simPnL;
    state.sim.balance += simPnL;
  }

  updateSimulatorUI();
}

function updateSimulatorUI() {
  const balEl = document.getElementById('sim-balance');
  const pnlEl = document.getElementById('sim-pnl');
  const countEl = document.getElementById('sim-trades-count');

  if (balEl) balEl.textContent = `$${state.sim.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  if (pnlEl) {
    const pnlPct = ((state.sim.balance - state.sim.startBalance) / state.sim.startBalance) * 100;
    pnlEl.textContent = `${state.sim.pnl >= 0 ? '+' : ''}$${state.sim.pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`;
    pnlEl.className = state.sim.pnl >= 0 ? 'text-green' : 'text-red';
  }
  if (countEl) countEl.textContent = `${state.sim.trades.length}`;
}

// ==========================================================================
// TRADER DETAIL INSPECTOR MODAL
// ==========================================================================
async function openTraderModal(address) {
  const modal = document.getElementById('trader-modal');
  if (!modal) return;

  const normalized = address.toLowerCase();
  const trader = state.leaderboard.find(t => t.address === normalized) || {
    address: normalized,
    displayName: 'Trader',
    accountValue: 0,
    day: {}, week: {}, month: {}, allTime: {}
  };

  state.selectedTrader = trader;

  const rankIdx = state.top50.findIndex(t => t.address === normalized);
  const rankEl = document.getElementById('modal-rank');
  if (rankEl) rankEl.textContent = rankIdx !== -1 ? `#${rankIdx + 1}` : 'PRO';

  document.getElementById('modal-address').textContent = trader.address;
  document.getElementById('modal-display-name').textContent = trader.displayName ? `ENS / Alias: ${trader.displayName}` : 'Hyperliquid L1 Smart Money';
  document.getElementById('modal-hl-link').href = `${CONFIG.PORTFOLIO_BASE}${trader.address}`;

  document.getElementById('mstat-equity').textContent = `$${formatNumber(trader.accountValue)}`;

  const allTimePnl = parseFloat(trader.allTime?.pnl || 0);
  const monthPnl = parseFloat(trader.month?.pnl || 0);
  const dayPnl = parseFloat(trader.day?.pnl || 0);

  const atEl = document.getElementById('mstat-alltime-pnl');
  atEl.textContent = `${allTimePnl >= 0 ? '+' : ''}$${formatNumber(allTimePnl)}`;
  atEl.className = `val ${allTimePnl >= 0 ? 'text-green' : 'text-red'}`;

  const mEl = document.getElementById('mstat-month-pnl');
  mEl.textContent = `${monthPnl >= 0 ? '+' : ''}$${formatNumber(monthPnl)}`;
  mEl.className = `val ${monthPnl >= 0 ? 'text-green' : 'text-red'}`;

  const dEl = document.getElementById('mstat-day-pnl');
  dEl.textContent = `${dayPnl >= 0 ? '+' : ''}$${formatNumber(dayPnl)}`;
  dEl.className = `val ${dayPnl >= 0 ? 'text-green' : 'text-red'}`;

  modal.classList.add('open');

  loadTraderPositions(trader.address);
  loadTraderOrders(trader.address);
  loadTraderFills(trader.address);
}

async function loadTraderPositions(address) {
  const tbody = document.getElementById('modal-positions-body');
  const countEl = document.getElementById('mcount-positions');
  tbody.innerHTML = `<tr><td colspan="8" class="loading-state mini"><div class="spinner"></div><span>Querying clearinghouse...</span></td></tr>`;

  try {
    const res = await fetch(CONFIG.INFO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: address })
    });
    const data = await res.json();
    const positions = data.assetPositions || [];
    if (countEl) countEl.textContent = positions.length;

    if (positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:20px;">No active open positions. Account is 100% in cash/USDC.</td></tr>`;
      return;
    }

    tbody.innerHTML = positions.map(p => {
      const pos = p.position;
      const szi = parseFloat(pos.szi || 0);
      const isLong = szi > 0;
      const entryPx = parseFloat(pos.entryPx || 0);
      const upnl = parseFloat(pos.unrealizedPnl || 0);
      const roe = parseFloat(pos.returnOnEquity || 0) * 100;
      const liq = pos.liquidationPx ? parseFloat(pos.liquidationPx) : null;
      const lev = pos.leverage?.value || 'Cross';

      return `
        <tr>
          <td><strong>${pos.coin}</strong></td>
          <td><span class="${isLong ? 'badge-action badge-open-long' : 'badge-action badge-open-short'}">${isLong ? 'LONG' : 'SHORT'}</span></td>
          <td class="text-right">${Math.abs(szi).toFixed(4)}</td>
          <td class="text-right">$${formatNumber(entryPx)}</td>
          <td class="text-right ${upnl >= 0 ? 'text-green' : 'text-red'} font-bold">${upnl >= 0 ? '+' : ''}$${formatNumber(upnl)}</td>
          <td class="text-right ${roe >= 0 ? 'text-green' : 'text-red'}">${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%</td>
          <td class="text-right text-muted">${lev}x</td>
          <td class="text-right text-dim">${liq ? `$${formatNumber(liq)}` : 'N/A'}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red">Failed to load positions: ${err.message}</td></tr>`;
  }
}

async function loadTraderOrders(address) {
  const tbody = document.getElementById('modal-orders-body');
  const countEl = document.getElementById('mcount-orders');
  tbody.innerHTML = `<tr><td colspan="7" class="loading-state mini"><div class="spinner"></div><span>Querying open orders & triggers...</span></td></tr>`;

  try {
    const res = await fetch(CONFIG.INFO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'frontendOpenOrders', user: address })
    });
    const orders = await res.json();
    if (countEl) countEl.textContent = orders.length;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">No pending limit or trigger orders (SL/TP) currently placed.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const isTrigger = o.isTrigger || o.triggerCondition !== 'N/A';
      const side = o.side === 'B' ? 'BUY' : 'SELL';
      return `
        <tr>
          <td><strong>${o.coin}</strong></td>
          <td><span class="tab-badge ${isTrigger ? 'pulse-badge' : ''}">${isTrigger ? '🎯 TRIGGER / SL-TP' : o.orderType || 'Limit'}</span></td>
          <td class="${side === 'BUY' ? 'text-green' : 'text-red'} font-bold">${side}</td>
          <td class="text-right">$${formatNumber(parseFloat(o.limitPx || 0))}</td>
          <td class="text-right text-cyan">${o.triggerCondition || 'Direct Fill'} (${o.triggerPx !== '0.0' ? `$${o.triggerPx}` : 'At Limit'})</td>
          <td class="text-right">${parseFloat(o.sz || 0).toFixed(4)}</td>
          <td class="text-center">${o.reduceOnly ? '✅ Yes' : 'No'}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red">Failed to load orders: ${err.message}</td></tr>`;
  }
}

async function loadTraderFills(address) {
  const tbody = document.getElementById('modal-fills-body');
  const countEl = document.getElementById('mcount-fills');
  tbody.innerHTML = `<tr><td colspan="7" class="loading-state mini"><div class="spinner"></div><span>Fetching recent execution fills...</span></td></tr>`;

  try {
    const res = await fetch(CONFIG.INFO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFills', user: address })
    });
    const fills = await res.json();
    if (countEl) countEl.textContent = fills.length;

    if (fills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">No historical fills found.</td></tr>`;
      return;
    }

    tbody.innerHTML = fills.slice(0, 30).map(f => {
      const dir = f.dir || (f.side === 'B' ? 'Buy' : 'Sell');
      const px = parseFloat(f.px || 0);
      const sz = parseFloat(f.sz || 0);
      const closedPnl = parseFloat(f.closedPnl || 0);
      const pnlSign = closedPnl >= 0 ? '+' : '';
      const pnlClass = closedPnl >= 0 ? 'text-green' : 'text-red';

      return `
        <tr>
          <td class="text-dim">${formatTimeAgo(f.time)}</td>
          <td><strong>${f.coin}</strong></td>
          <td><span class="badge-action ${dir.includes('Long') ? 'badge-open-long' : 'badge-open-short'}">${dir}</span></td>
          <td class="text-right">$${formatNumber(px)}</td>
          <td class="text-right">${sz.toFixed(4)}</td>
          <td class="text-right ${pnlClass} font-bold">${closedPnl !== 0 ? `${pnlSign}$${formatNumber(closedPnl)}` : '--'}</td>
          <td class="text-center">
            ${f.hash ? `<a href="${CONFIG.EXPLORER_BASE}${f.hash}" target="_blank" rel="noopener" style="color:var(--neon-cyan);text-decoration:none;">View ↗</a>` : '--'}
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red">Failed to load fills: ${err.message}</td></tr>`;
  }
}

function renderSidebarOrders(orderUpdates) {
  const container = document.getElementById('sidebar-orders-list');
  if (!container) return;

  if (!orderUpdates || orderUpdates.length === 0) {
    container.innerHTML = `<div class="subtext text-center text-dim" style="padding:16px;">Watching for real-time limit & SL/TP orders...</div>`;
    return;
  }

  container.innerHTML = orderUpdates.slice(0, 5).map(o => {
    return `
      <div style="background:var(--bg-secondary); padding:10px; border-radius:4px; margin-bottom:8px; font-family:var(--font-mono); font-size:0.75rem;">
        <div style="display:flex; justify-content:space-between;">
          <strong>${o.order?.coin || 'ASSET'}</strong>
          <span class="${o.order?.side === 'B' ? 'text-green' : 'text-red'}">${o.order?.side === 'B' ? 'BUY' : 'SELL'}</span>
        </div>
        <div style="color:var(--text-muted); font-size:0.7rem; margin-top:2px;">
          Limit: $${formatNumber(parseFloat(o.order?.limitPx || 0))} • Sz: ${parseFloat(o.order?.sz || 0).toFixed(2)}
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// NOISE FILTER SETTINGS MODAL BINDINGS
// ==========================================================================
function syncNoiseSettingsInputs() {
  const f = state.noiseFilter;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('setting-macro-traders', f.macroConsensusThreshold);
  setVal('setting-macro-window', f.macroWindowMinutes);
  setVal('setting-flash-traders', f.flashMomentumThreshold);
  setVal('setting-flash-window', f.flashWindowMinutes);
  setVal('setting-min-notional', f.minNotionalUSD);
  setVal('setting-min-equity-pct', f.minEquityWeightPct);
  setVal('setting-anti-scalp-min', f.excludeScalpsUnderMin);
  setVal('setting-exclude-hedge', f.excludeDeltaNeutral ? 'true' : 'false');
}

function readNoiseSettingsInputs() {
  const getVal = (id, def) => {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : def;
  };

  state.noiseFilter.macroConsensusThreshold = getVal('setting-macro-traders', 27);
  state.noiseFilter.macroWindowMinutes = getVal('setting-macro-window', 120);
  state.noiseFilter.flashMomentumThreshold = getVal('setting-flash-traders', 8);
  state.noiseFilter.flashWindowMinutes = getVal('setting-flash-window', 30);
  state.noiseFilter.minNotionalUSD = getVal('setting-min-notional', 50000);
  state.noiseFilter.minEquityWeightPct = getVal('setting-min-equity-pct', 5.0);
  state.noiseFilter.excludeScalpsUnderMin = getVal('setting-anti-scalp-min', 3);
  state.noiseFilter.excludeDeltaNeutral = document.getElementById('setting-exclude-hedge')?.value === 'true';

  saveNoiseFilterSettings();
  updateNoiseFilterSummaryText();
  renderFeedCards();
  renderConsensusRadar();
  updateNoiseFilterStatsUI();
}

function updateNoiseFilterSummaryText() {
  const f = state.noiseFilter;
  const textEl = document.getElementById('noise-rule-text');
  if (textEl) {
    textEl.innerHTML = `
      1) 🏛️ Macro: ≥${f.macroConsensusThreshold} traders (${f.macroWindowMinutes}m) &nbsp;|&nbsp; 
      2) ⚡ Flash: ≥${f.flashMomentumThreshold} traders (${f.flashWindowMinutes}m) &nbsp;|&nbsp; 
      3) 🐋 Conviction: ≥$${formatNumber(f.minNotionalUSD)} &gt;${f.minEquityWeightPct}% Equity (${f.excludeScalpsUnderMin}m Anti-Scalp)
    `;
  }
}

// ==========================================================================
// UTILITY HELPERS
// ==========================================================================
function formatNumber(val) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  const num = Math.abs(val);
  if (num >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (val / 1e3).toFixed(2) + 'K';
  if (num < 1 && num > 0) return val.toFixed(4);
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function toggleTrackTrader(address, checked) {
  const normalized = address.toLowerCase();
  if (checked) {
    state.trackedTraders.add(normalized);
  } else {
    state.trackedTraders.delete(normalized);
  }
  initWebSockets();
  showToast('Tracking Updated', `${checked ? 'Subscribed to' : 'Unsubscribed from'} ${normalized.slice(0, 8)}...`, 'long');
}

// ==========================================================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Load saved Noise Filter settings from localStorage
  loadSavedSettings();
  registerServiceWorker();

  // Noise Filter Toggle Button
  const noiseToggleBtn = document.getElementById('btn-toggle-noise-filter');
  const noiseLabel = document.getElementById('noise-switch-label');

  if (noiseToggleBtn) {
    noiseToggleBtn.classList.toggle('active', state.noiseFilter.enabled);
    if (noiseLabel) noiseLabel.textContent = state.noiseFilter.enabled ? 'Noise Filter: ON (Default)' : 'Noise Filter: OFF (Raw)';

    noiseToggleBtn.addEventListener('click', () => {
      state.noiseFilter.enabled = !state.noiseFilter.enabled;
      noiseToggleBtn.classList.toggle('active', state.noiseFilter.enabled);
      if (noiseLabel) {
        noiseLabel.textContent = state.noiseFilter.enabled ? 'Noise Filter: ON (Default)' : 'Noise Filter: OFF (Raw)';
      }
      saveNoiseFilterSettings();
      updateNoiseFilterStatsUI();
      renderFeedCards();
      showToast('Noise Filter', `Noise Filter is now ${state.noiseFilter.enabled ? 'ACTIVE (Eliminating noise/scalps)' : 'DISABLED (Streaming raw fills)'}`, 'long');
    });
  }

  // Show Filtered Noise Checkbox
  const chkShowNoise = document.getElementById('chk-show-noise');
  if (chkShowNoise) {
    chkShowNoise.addEventListener('change', (e) => {
      state.showFilteredNoise = e.target.checked;
      renderFeedCards();
    });
  }

  // Noise Filter Settings Modal
  const openNoiseSettingsBtn = document.getElementById('btn-open-noise-settings');
  const noiseModal = document.getElementById('noise-settings-modal');
  const closeNoiseModalBtn = document.getElementById('noise-modal-close');
  const saveNoiseBtn = document.getElementById('btn-save-noise-settings');
  const resetNoiseBtn = document.getElementById('btn-reset-noise-settings');

  if (openNoiseSettingsBtn && noiseModal) {
    openNoiseSettingsBtn.addEventListener('click', () => {
      syncNoiseSettingsInputs();
      noiseModal.classList.add('open');
    });
  }

  if (closeNoiseModalBtn && noiseModal) {
    closeNoiseModalBtn.addEventListener('click', () => {
      noiseModal.classList.remove('open');
    });
  }

  if (noiseModal) {
    noiseModal.addEventListener('click', (e) => {
      if (e.target.id === 'noise-settings-modal') {
        noiseModal.classList.remove('open');
      }
    });
  }

  if (saveNoiseBtn) {
    saveNoiseBtn.addEventListener('click', () => {
      readNoiseSettingsInputs();
      noiseModal.classList.remove('open');
      showToast('Settings Saved', 'Noise Filter thresholds updated and saved to localStorage.', 'long');
    });
  }

  if (resetNoiseBtn) {
    resetNoiseBtn.addEventListener('click', () => {
      state.noiseFilter = { ...DEFAULT_NOISE_FILTER };
      saveNoiseFilterSettings();
      syncNoiseSettingsInputs();
      updateNoiseFilterSummaryText();
      renderFeedCards();
      renderConsensusRadar();
      updateNoiseFilterStatsUI();
      showToast('Reset Complete', 'Noise Filter reset to default parameters.', 'long');
    });
  }

  // Navigation Tabs
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const paneId = tab.dataset.tab;
      const targetPane = document.getElementById(paneId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Timeframe Sorter
  const tfButtons = document.querySelectorAll('.btn-tf');
  tfButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tfButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      sortAndFilterLeaderboard();
      renderLeaderboard();
    });
  });

  // Audio Controls
  const soundToggle = document.getElementById('btn-sound-toggle');
  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      soundToggle.classList.toggle('active', state.soundEnabled);
      soundToggle.querySelector('.label').textContent = state.soundEnabled ? 'Sound ON' : 'Sound OFF';
    });
  }

  const testSoundBtn = document.getElementById('btn-test-sound');
  if (testSoundBtn) {
    testSoundBtn.addEventListener('click', () => {
      soundEngine.playTradeChime(true, true, true);
      showToast('Sound Test', 'Consensus cluster fanfare chime played!', 'long');
    });
  }

  // Desktop Notification Permission
  const notifyBtn = document.getElementById('btn-notify-perm');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', async () => {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          notifyBtn.classList.add('active');
          document.getElementById('btn-notify-label').textContent = 'Alerts ON';
          showToast('Notifications Enabled', 'Desktop alerts are active for all smart money fills.', 'long');
        }
      }
    });
  }

  // Refresh All
  const refreshBtn = document.getElementById('btn-refresh-all');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchLeaderboard();
      showToast('Refreshing', 'Reloading latest Hyperliquid L1 Top 50 data...', 'long');
    });
  }

  // Filter Selects
  document.getElementById('filter-feed-asset')?.addEventListener('change', renderFeedCards);
  document.getElementById('filter-feed-size')?.addEventListener('change', renderFeedCards);

  // Clear Feed
  document.getElementById('btn-clear-feed')?.addEventListener('click', () => {
    state.feedItems = [];
    renderFeedCards();
  });

  // Export JSON
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.feedItems, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperliquid-top50-fills-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Calculator Form Events
  document.getElementById('calc-leader-select')?.addEventListener('change', updateCalculatorPreview);
  document.getElementById('calc-copier-balance')?.addEventListener('input', updateCalculatorPreview);
  document.getElementById('calc-max-leverage')?.addEventListener('change', updateCalculatorPreview);
  document.getElementById('calc-max-alloc')?.addEventListener('input', updateCalculatorPreview);

  // Simulator Reset
  document.getElementById('btn-reset-sim')?.addEventListener('click', () => {
    state.sim.balance = 10000.0;
    state.sim.pnl = 0.0;
    state.sim.trades = [];
    updateSimulatorUI();
    showToast('Simulator Reset', 'Paper balance reset to $10,000.00 USDC.', 'long');
  });

  // Modal Close
  document.getElementById('modal-close')?.addEventListener('click', () => {
    document.getElementById('trader-modal')?.classList.remove('open');
  });
  document.getElementById('trader-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'trader-modal') {
      document.getElementById('trader-modal')?.classList.remove('open');
    }
  });

  // Modal Sub-tabs
  const modalTabs = document.querySelectorAll('.modal-tab');
  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.modaltab)?.classList.add('active');
    });
  });

  // Track All 50 in Feed
  document.getElementById('btn-track-all')?.addEventListener('click', () => {
    state.top50.forEach(t => state.trackedTraders.add(t.address));
    renderLeaderboard();
    initWebSockets();
    showToast('Subscribed', 'Tracking all Top 50 traders across 5 WebSockets.', 'long');
  });

  // Recompute Analytics
  document.getElementById('btn-recompute-analytics')?.addEventListener('click', () => {
    scanActivePositions();
    showToast('Recomputing', 'Refreshed consensus radar and position states.', 'long');
  });

  // Copy Bot Script Path
  document.getElementById('btn-copy-script-path')?.addEventListener('click', () => {
    navigator.clipboard.writeText('python3 copy_bot.py --noise-filter');
    showToast('Copied to Clipboard', 'Run command copied: python3 copy_bot.py --noise-filter', 'long');
  });

  updateNoiseFilterSummaryText();

  // Auto-refresh leaderboard periodically (checks for reshuffles every 60s)
  setInterval(fetchLeaderboard, CONFIG.POLL_REFRESH_MS);

  // Initial Boot
  fetchLeaderboard();
});

# HyperTrack Pro // Hyperliquid Top 50 & Noise-Filtered Copy Trading Intel Terminal

A real-time on-chain intelligence terminal and automated copy trading system built specifically for **Hyperliquid L1**.

---

## ⚡ Core Features (V2.0)

1. **Top 50 Leaderboard Tracking & Reshuffle Detection**
   - High-performance on-chain rank parsing from `https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`.
   - Automatically monitors the **Top 50** elite traders.
   - **Leaderboard Reshuffle Detection**: Checks for changes every 60s and alerts you whenever a trader enters or leaves the Top 50, updating WebSocket subscriptions dynamically.
   - Real-time PnL & ROI windows: **Day**, **Week**, **Month**, and **All-Time**.

2. **5x WebSocket Real-Time Trade Stream**
   - Direct connection to Hyperliquid Mainnet WebSockets: `wss://api.hyperliquid.xyz/ws`.
   - Maintains **5 parallel WebSocket connections** (10 traders per socket) to stream real-time fills and order updates for all 50 top traders simultaneously.

3. **🛡️ Noise Filter Engine (Default Active with OR Logic)**
   Filters out dust trades, bait orders, micro-scalps, and delta-neutral hedging so you are only alerted to genuine, high-conviction smart money momentum. A trade passes if **ANY** of the following conditions are met:
   - **Rule 1: 🏛️ Macro Consensus Clustering:**
     $\ge 27$ traders from the Top 50 open positions in the same coin and same direction within a **60–120 minute** rolling window.
   - **Rule 2: ⚡ Flash Momentum Clustering:**
     $\ge 8$ traders from the Top 50 open positions in the same coin and same direction within a **15–30 minute** rolling window.
   - **Rule 3: 🐋 High-Conviction Whale Execution:**
     Position notional value $\ge \$50,000$ USD (configurable) **AND** represents $\ge 5\%$ of the trader's total account equity, with **anti-scalp** ($<3$ min hold time) and **delta-neutral hedging exclusion**.
   - **Customizable & Persistent:** Settings can be customized in the UI modal and are saved in `localStorage`.

4. **📡 Smart Money Consensus Radar (Asset Preference Tab)**
   - Live visual meters tracking consensus clusters across all major coins in real time.
   - Distinguishes building momentum from **Flash Consensus** ($\ge 8$ traders) and **Macro Consensus** ($\ge 27$ traders).
   - High-conviction trade ledger showing all trades where elite traders staked $>5\%$ of their equity.

5. **Persistent Background Notifications & Audio Chimes**
   - Includes **Service Worker (`sw.js`)** registration so trade alerts can pop up even when the browser tab is minimized or in the background.
   - Synthesizer dual-tone audio chimes (Web Audio API) for instant audio feedback without external audio files.

6. **Automated Copy Trading Command & Python Daemon (`copy_bot.py`)**
   - Proportional position sizing calculator with leverage caps and risk guardrails.
   - Built-in Paper Copy Simulator.
   - Upgraded companion daemon script with full Top 50 streaming and Noise Filter support.

---

## 🚀 How to Run the Web Application

The application is built with standard web technologies (HTML5, Vanilla CSS, and modern JavaScript) and connects directly to Hyperliquid APIs without needing any build step.

### Local URL:
- **`http://localhost:3000`** (using the running Python simple server)
- Or via LAMPP Apache: **`http://localhost/hyperliquid-tracker/`**

---

## 🤖 Running the Companion Copy Bot (`copy_bot.py`)

### 1. Dry-Run / Paper Simulation Mode (Tracking Top 50 with Noise Filter):
```bash
python3 copy_bot.py --balance 2000
```

### 2. Live L1 Execution Mode (Requires Agent Wallet Key):
```bash
python3 copy_bot.py \
  --account 0xYourMasterAddress \
  --agent-key 0xYourAgentPrivateKey \
  --balance 2000 \
  --max-leverage 3 \
  --live
```

### 3. Track a Specific Leader Trader:
```bash
python3 copy_bot.py \
  --leader 0x85ecf584f25db6f146718b86d493e33c5af72052 \
  --balance 2000
```

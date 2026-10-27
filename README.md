# HyperTrack Pro // Hyperliquid Leaderboard & Copy Trading Intel Terminal

A real-time on-chain intelligence terminal and automated copy trading system built specifically for **Hyperliquid L1**.

---

## ⚡ Core Features

1. **Top 20 Leaderboard Tracking**
   - High-performance on-chain rank parsing from `https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`.
   - Real-time PnL & ROI windows: **Day**, **Week**, **Month**, and **All-Time**.
   - Account equity monitoring and 24h trading volume.
   - One-click inspection of any trader's live portfolio.

2. **Real-time Live Trade Feed & SL/TP Triggers**
   - Direct connection to Hyperliquid Mainnet WebSocket: `wss://api.hyperliquid.xyz/ws`.
   - Monitors `userFills` for trade executions (Open Long, Close Long, Open Short, Close Short).
   - Monitors `orderUpdates` & `frontendOpenOrders` for active limit orders and Stop Loss / Take Profit trigger conditions.
   - Built-in **Web Audio API synthesizer**: plays pleasant dual-tone chimes for buys/longs and sells/shorts (plus fanfare for whale trades >$50k).
   - Browser desktop notifications and sliding toast alerts.

3. **Smart Money Asset Preference & Tendency Matrix**
   - Aggregates recent fills across the leaderboard to calculate:
     - **Most Traded Assets**: Visual volume distribution (BTC, ETH, SOL, HYPE, etc.).
     - **Directional Bias**: Net Bullish vs Bearish ratio across all top 20 traders.
     - **Active Positions Matrix**: Combined open long contracts vs short contracts in USD.
     - **Execution Style Classification**: Distinguishes HFT scalpers from high-conviction swing traders.

4. **Copy Trading Command Center & Calculator**
   - **Proportional Position Sizing**:
     $$\text{CopierSize} = \left(\frac{\text{LeaderTradeUSD}}{\text{LeaderEquity}}\right) \times \text{CopierBalance}$$
   - Leverage caps (e.g. max 3x) and maximum allocation per coin (e.g. 25%).
   - Slippage tolerance guardrails.
   - **Paper Copy Simulator**: Replicates live fills in virtual paper mode to test copy-trade strategies before committing funds.

5. **Non-Custodial Agent Wallet Execution Daemon (`copy_bot.py`)**
   - Included Python background script that listens to WebSocket fills from your selected Leader and places matching orders on Hyperliquid L1.

---

## 🚀 How to Run the Web Application

The application is built with standard web technologies (HTML5, Vanilla CSS, and modern JavaScript) and connects directly to Hyperliquid APIs without needing any proxy or backend build step.

### Option A: Using Python built-in server (Port 3000)
```bash
python3 -m http.server 3000 --directory /opt/lampp/htdocs/hyperliquid-tracker
```
Then open: **`http://localhost:3000`** in your browser.

### Option B: Using XAMPP / LAMPP Apache
Since the files are located in `/opt/lampp/htdocs/hyperliquid-tracker`, if your Apache server is running, simply visit:
**`http://localhost/hyperliquid-tracker/`**

---

## 🔒 How Hyperliquid Copy Trading & Agent Wallets Work

Unlike centralized exchanges that use API keys with full permissions, Hyperliquid uses **cryptographic Agent Wallets (EIP-712)**:

### 1. What is an Agent Wallet?
An Agent Wallet is a secondary Ethereum keypair that you authorize to sign orders on your behalf.
- **Can:** Open positions, close positions, place limit orders, set Stop Loss / Take Profit.
- **CANNOT:** Withdraw funds, transfer tokens, or alter your account ownership.

### 2. How to create an Agent Wallet on Hyperliquid:
1. Go to the [Hyperliquid API Settings](https://app.hyperliquid.xyz/API).
2. Click **"Create Agent"**.
3. Sign the approval transaction with your Master wallet.
4. Save the generated **Agent Private Key**.

### 3. Running the Headless Python Bot (`copy_bot.py`):
```bash
# 1. Install dependencies
pip install requests websockets

# 2. Run in Dry-Run / Paper Simulation mode (Safe, no real money)
python3 copy_bot.py --leader 0x85ecf584f25db6f146718b86d493e33c5af72052 --balance 2000

# 3. Run with Live L1 Execution (Requires Agent Key)
python3 copy_bot.py \
  --leader 0x85ecf584f25db6f146718b86d493e33c5af72052 \
  --account 0xYourMasterAddress \
  --agent-key 0xYourAgentPrivateKey \
  --balance 2000 \
  --max-leverage 3 \
  --live
```

---

## 💡 Native Vaults Alternative (Zero-Code Copy Trading)
If you do not want to run any code or scripts, Hyperliquid has native **On-Chain Vaults**:
- Top traders can create a public vault on Hyperliquid.
- Users can deposit USDC directly into the vault.
- When the leader trades, all deposits are automatically copied natively on the L1 blockchain.
- You can find public vaults directly on `https://app.hyperliquid.xyz/vaults`.

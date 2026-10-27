#!/usr/bin/env python3
"""
Hyperliquid Automated Copy Trading Engine (Python Daemon V2.0)
=============================================================
Monitors Top 50 Leaderboard Traders on Hyperliquid Mainnet L1 via WebSockets
and automatically replicates their high-conviction orders proportionally
onto your account using an Agent Wallet Private Key.

Includes Noise Filter Engine (OR Logic):
1) Macro Consensus: ≥27 traders open same coin & direction (60-120m)
2) Flash Momentum: ≥8 traders open same coin & direction (15-30m)
3) High Conviction: ≥$50,000 USD and ≥5% of trader's account equity (Anti-Scalp & Anti-Hedge)
"""

import os
import sys
import json
import time
import asyncio
import argparse
from typing import Dict, Any, Optional, List, Set

try:
    import websockets
except ImportError:
    print("[!] 'websockets' library not installed. Install with: pip install websockets")
    websockets = None

try:
    import requests
except ImportError:
    print("[!] 'requests' library not installed. Install with: pip install requests")
    requests = None


# Hyperliquid Endpoints
MAINNET_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
MAINNET_INFO_URL = "https://api.hyperliquid.xyz/info"
MAINNET_WS_URL = "wss://api.hyperliquid.xyz/ws"
MAINNET_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange"


class HyperliquidCopyBot:
    def __init__(
        self,
        leader_address: Optional[str] = None,
        account_address: str = "0x0000000000000000000000000000000000000000",
        agent_private_key: Optional[str] = None,
        copier_balance_usd: float = 2000.0,
        max_leverage: int = 3,
        max_allocation_pct: float = 25.0,
        slippage_tolerance_pct: float = 0.2,
        dry_run: bool = True,
        use_noise_filter: bool = True,
        track_top50: bool = True
    ):
        self.leader_address = leader_address.lower() if leader_address else None
        self.account_address = account_address.lower()
        self.agent_private_key = agent_private_key
        self.copier_balance = copier_balance_usd
        self.max_leverage = max_leverage
        self.max_alloc = max_allocation_pct
        self.slippage_tolerance = slippage_tolerance_pct
        self.dry_run = dry_run
        self.use_noise_filter = use_noise_filter
        self.track_top50 = track_top50

        # State storage
        self.top50_traders: Dict[str, Dict[str, Any]] = {}
        self.cluster_trade_log: List[Dict[str, Any]] = []
        self.running = True

    def fetch_top50_leaderboard(self) -> List[str]:
        """Fetches the top 50 traders from Hyperliquid Mainnet L1."""
        if not requests:
            return [self.leader_address] if self.leader_address else []

        try:
            print("[*] Fetching Top 50 Leaderboard from Hyperliquid L1...")
            headers = {"Range": "bytes=0-125000", "User-Agent": "Mozilla/5.0"}
            res = requests.get(MAINNET_LEADERBOARD_URL, headers=headers, timeout=10)
            text = res.text
            last_brace = text.rfind("},")
            if last_brace != -1:
                valid_json = text[:last_brace + 1] + "]}"
                data = json.loads(valid_json)
                rows = data.get("leaderboardRows", [])
                
                self.top50_traders.clear()
                addresses = []
                for idx, r in enumerate(rows[:50]):
                    addr = r.get("ethAddress", "").lower()
                    equity = float(r.get("accountValue", 0))
                    self.top50_traders[addr] = {
                        "rank": idx + 1,
                        "address": addr,
                        "displayName": r.get("displayName"),
                        "equity": equity
                    }
                    addresses.append(addr)

                print(f"[✓] Successfully loaded Top 50 leaderboard. Total capital: ${sum(t['equity'] for t in self.top50_traders.values()):,.2f} USD")
                return addresses
        except Exception as e:
            print(f"[!] Warning: Could not fetch Top 50 leaderboard: {e}")
            if self.leader_address:
                return [self.leader_address]
            return []

    def evaluate_noise_filter(self, fill: Dict[str, Any], trader_equity: float) -> Dict[str, Any]:
        """
        Evaluates fill against OR Logic Noise Filter:
        1) Macro Consensus: ≥27 traders (120 min window)
        2) Flash Momentum: ≥8 traders (30 min window)
        3) High Conviction: ≥$50,000 USD and ≥5% of trader's total equity (Anti-Scalp & Anti-Hedge)
        """
        if not self.use_noise_filter:
            return {"passed": True, "reason": "FILTER_OFF", "badge": "RAW"}

        now = fill.get("time", int(time.time() * 1000))
        coin = fill.get("coin")
        dir_str = fill.get("dir", "")
        side = fill.get("side", "")
        is_long = "Long" in dir_str or side == "B"
        norm_dir = "LONG" if is_long else "SHORT"
        user = fill.get("user", "").lower()
        px = float(fill.get("px", 0))
        sz = float(fill.get("sz", 0))
        notional_usd = px * sz

        # 1. Check Delta-Neutral Hedging (opposing position within 3 minutes)
        for prior in self.cluster_trade_log:
            if prior["user"] == user and prior["coin"] == coin and prior["norm_dir"] != norm_dir:
                if (now - prior["time"]) < 180000:
                    return {"passed": False, "reason": "DELTA_NEUTRAL_HEDGE"}

        # 2. Rule 2: Flash Momentum Clustering (≥8 traders in last 30 mins)
        flash_window_ms = 30 * 60 * 1000
        flash_traders: Set[str] = {user}
        for t in self.cluster_trade_log:
            if t["coin"] == coin and t["norm_dir"] == norm_dir and (now - t["time"]) <= flash_window_ms:
                flash_traders.add(t["user"])

        if len(flash_traders) >= 8:
            return {
                "passed": True,
                "reason": "FLASH_MOMENTUM_CLUSTER",
                "badge": f"⚡ FLASH CLUSTER ({len(flash_traders)}/8 TRADERS)"
            }

        # 3. Rule 1: Macro Consensus Clustering (≥27 traders in last 120 mins)
        macro_window_ms = 120 * 60 * 1000
        macro_traders: Set[str] = {user}
        for t in self.cluster_trade_log:
            if t["coin"] == coin and t["norm_dir"] == norm_dir and (now - t["time"]) <= macro_window_ms:
                macro_traders.add(t["user"])

        if len(macro_traders) >= 27:
            return {
                "passed": True,
                "reason": "MACRO_CONSENSUS_CLUSTER",
                "badge": f"🏛️ MACRO CONSENSUS ({len(macro_traders)}/27 TRADERS)"
            }

        # 4. Rule 3: High Conviction Whale Execution
        size_ok = notional_usd >= 50000.0
        equity_weight_pct = (notional_usd / trader_equity * 100.0) if trader_equity > 0 else 0
        weight_ok = equity_weight_pct >= 5.0

        # Anti-scalp: check if trader made a fill in last 3 minutes
        is_scalp = False
        for prior in self.cluster_trade_log:
            if prior["user"] == user and prior["coin"] == coin and (now - prior["time"]) < 180000:
                is_scalp = True
                break

        if size_ok and weight_ok and not is_scalp:
            return {
                "passed": True,
                "reason": "HIGH_CONVICTION_WHALE",
                "badge": f"🐋 CONVICTION ({equity_weight_pct:.1f}% EQUITY)"
            }

        return {"passed": False, "reason": "FILTERED_NOISE"}

    def calculate_replicated_size(self, fill: Dict[str, Any], leader_equity: float) -> Optional[Dict[str, Any]]:
        """Calculates proportional position size."""
        coin = fill.get("coin")
        px = float(fill.get("px", 0))
        sz = float(fill.get("sz", 0))
        notional_leader = px * sz
        direction = fill.get("dir", "Trade")
        side = fill.get("side")

        if notional_leader <= 0 or px <= 0:
            return None

        equity = leader_equity if leader_equity > 0 else 10_000_000.0
        weight = notional_leader / equity
        target_usd = self.copier_balance * weight

        # Enforce max allocation constraint
        max_usd = self.copier_balance * (self.max_alloc / 100.0)
        if target_usd > max_usd:
            target_usd = max_usd

        if target_usd < 10.0:
            return None

        target_sz = target_usd / px

        return {
            "coin": coin,
            "direction": direction,
            "side": side,
            "px": px,
            "target_sz": target_sz,
            "target_usd": target_usd,
            "weight_pct": weight * 100.0
        }

    def execute_order(self, order_plan: Dict[str, Any], filter_badge: str):
        """Places live order on Hyperliquid or prints simulation log."""
        coin = order_plan["coin"]
        px = order_plan["px"]
        sz = order_plan["target_sz"]
        side = order_plan["side"]
        usd = order_plan["target_usd"]
        is_buy = side == "B"

        if self.dry_run:
            print("\n" + "=" * 65)
            print(f" [SIMULATION / DRY-RUN] REPLICATED TRADE TRIGGERED! [{filter_badge}]")
            print(f" -> Asset:     {coin}")
            print(f" -> Direction: {order_plan['direction']} ({'BUY' if is_buy else 'SELL'})")
            print(f" -> Price:     ${px:,.4f}")
            print(f" -> Size:      {sz:.4f} {coin} (~${usd:,.2f} USD)")
            print(f" -> Ratio:     {order_plan['weight_pct']:.3f}% of copier portfolio")
            print("=" * 65 + "\n")
            return

        try:
            from hyperliquid.exchange import Exchange
            from hyperliquid.utils import constants

            exchange = Exchange(
                wallet=self.agent_private_key,
                base_url=constants.MAINNET_API_URL,
                account_address=self.account_address
            )

            slip = (self.slippage_tolerance / 100.0)
            limit_px = px * (1.0 + slip) if is_buy else px * (1.0 - slip)

            result = exchange.order(
                name=coin,
                is_buy=is_buy,
                sz=round(sz, 4),
                limit_px=round(limit_px, 4),
                order_type={"limit": {"tif": "Ioc"}}
            )
            print(f"[✓] LIVE ORDER PLACED ({filter_badge}): {result}")
        except ImportError:
            print("[!] Install the official SDK for live orders: pip install hyperliquid-python-sdk")
        except Exception as e:
            print(f"[✗] Order execution error: {e}")

    async def stream_socket_chunk(self, users_chunk: List[str], chunk_idx: int):
        """Maintains a single WebSocket connection for up to 10 users with auto-reconnect."""
        while self.running:
            try:
                async with websockets.connect(MAINNET_WS_URL) as ws:
                    for u in users_chunk:
                        await ws.send(json.dumps({
                            "method": "subscribe",
                            "subscription": {"type": "userFills", "user": u}
                        }))

                    # Keepalive ping
                    async def ping_loop():
                        while True:
                            await asyncio.sleep(25)
                            try:
                                await ws.send(json.dumps({"method": "ping"}))
                            except Exception:
                                break

                    ping_task = asyncio.create_task(ping_loop())

                    async for message in ws:
                        data = json.loads(message)
                        channel = data.get("channel")

                        if channel == "userFills":
                            payload = data.get("data", {})
                            if payload.get("isSnapshot", False):
                                continue

                            for fill in payload.get("fills", []):
                                user = (data.get("user") or fill.get("user") or "").lower()
                                fill["user"] = user
                                coin = fill.get("coin")
                                dir_str = fill.get("dir", "")
                                px = float(fill.get("px", 0))
                                sz = float(fill.get("sz", 0))
                                notional = px * sz
                                is_long = "Long" in dir_str or fill.get("side") == "B"
                                fill["norm_dir"] = "LONG" if is_long else "SHORT"

                                # Record in rolling log
                                self.cluster_trade_log.append(fill)

                                trader_info = self.top50_traders.get(user, {})
                                trader_equity = trader_info.get("equity", 10_000_000.0)

                                # Evaluate Noise Filter
                                verdict = self.evaluate_noise_filter(fill, trader_equity)

                                if verdict["passed"]:
                                    print(f"\n[⚡] QUALIFIED FILL: {coin} {dir_str} ${px:,.2f} (${notional:,.2f}) [{verdict['badge']}]")
                                    plan = self.calculate_replicated_size(fill, trader_equity)
                                    if plan:
                                        self.execute_order(plan, verdict["badge"])
                                else:
                                    # Filtered noise
                                    pass

                    ping_task.cancel()

            except Exception as e:
                print(f"[!] Socket #{chunk_idx} error: {e}. Reconnecting in 4s...")
                await asyncio.sleep(4)

    async def run(self):
        """Starts the multi-socket listener for the Top 50 traders."""
        if not websockets:
            print("[!] 'websockets' package missing. Run: pip install websockets")
            return

        print("=" * 65)
        print("  HYPERTRACK COPY TRADING DAEMON V2.0 (TOP 50 + NOISE FILTER)")
        print("=" * 65)
        print(f"[*] Copier Mode:    {'DRY-RUN / SIMULATION' if self.dry_run else 'LIVE L1 EXECUTION'}")
        print(f"[*] Capital Base:   ${self.copier_balance:,.2f} USD | Max Leverage: {self.max_leverage}x")
        print(f"[*] Noise Filter:   {'ACTIVE (OR: 27+ Macro / 8+ Flash / $50K+ Conviction)' if self.use_noise_filter else 'DISABLED'}")

        # Fetch Top 50 traders
        addresses = self.fetch_top50_leaderboard() if self.track_top50 else ([self.leader_address] if self.leader_address else [])
        if not addresses:
            print("[!] No traders to monitor. Exiting.")
            return

        # Divide into chunks of 10 users per WebSocket
        chunks = [addresses[i:i + 10] for i in range(0, len(addresses), 10)]
        print(f"[*] Launching {len(chunks)} parallel WebSocket connections for {len(addresses)} traders...")

        tasks = [self.stream_socket_chunk(chunk, idx + 1) for idx, chunk in enumerate(chunks)]
        await asyncio.gather(*tasks)


def parse_arguments():
    parser = argparse.ArgumentParser(description="Hyperliquid Top 50 Copy Trading Bot with Noise Filter")
    parser.add_argument("--leader", type=str, default=None,
                        help="Target specific leader address (defaults to tracking Top 50)")
    parser.add_argument("--account", type=str, default="0x0000000000000000000000000000000000000000",
                        help="Your Master Account address on Hyperliquid")
    parser.add_argument("--agent-key", type=str, default=os.getenv("HYPERLIQUID_AGENT_KEY"),
                        help="Agent Wallet Private Key (from Hyperliquid API tab)")
    parser.add_argument("--balance", type=float, default=2000.0,
                        help="Your available USDC capital for copy trading")
    parser.add_argument("--max-leverage", type=int, default=3,
                        help="Maximum allowable leverage")
    parser.add_argument("--no-noise-filter", action="store_true",
                        help="Disable the Noise Filter (streams all raw fills)")
    parser.add_argument("--live", action="store_true",
                        help="Enable real live order placement (default is dry-run simulator)")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_arguments()

    bot = HyperliquidCopyBot(
        leader_address=args.leader,
        account_address=args.account,
        agent_private_key=args.agent_key,
        copier_balance_usd=args.balance,
        max_leverage=args.max_leverage,
        dry_run=not args.live,
        use_noise_filter=not args.no_noise_filter,
        track_top50=args.leader is None
    )

    try:
        asyncio.run(bot.run())
    except KeyboardInterrupt:
        print("\n[!] Copy Bot stopped by user.")

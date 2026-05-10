#!/usr/bin/env python3
"""
G2 WebSocket Server
===================
A lightweight WebSocket server that bridges G2 glasses and Dashboard browsers.

Protocol
--------
Glasses → Server : JSON  { "type": "glasses-input", "event": str, "timestamp": int }
Server  → Glasses: Plain text string (displayed on the glasses)

Dashboard → Server : JSON  { "type": "register" }                    <- register as Dashboard
                     JSON  { "type": "send-text", "text": str }       <- send text to all glasses
Server  → Dashboard: JSON  (glasses-input events forwarded as-is)
                     JSON  { "type": "status", "glasses": int, "dashboards": int }

Usage
-----
  python server.py

  WebSocket : ws://0.0.0.0:8765   <- address for G2 glasses / Dashboard to connect
  HTTP      : http://0.0.0.0:8080 <- open in browser for the Dashboard UI
"""

import asyncio
import json
import logging
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import websockets
from websockets.asyncio.server import ServerConnection

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WS_HOST   = "0.0.0.0"
WS_PORT   = 8765
HTTP_PORT = 8080

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("g2-ws-server")

# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------
glasses_clients: set[ServerConnection]   = set()
dashboard_clients: set[ServerConnection] = set()


async def _broadcast_status() -> None:
    """Broadcast the current connection status to all Dashboard clients."""
    if not dashboard_clients:
        return
    msg = json.dumps({
        "type":       "status",
        "glasses":    len(glasses_clients),
        "dashboards": len(dashboard_clients),
    })
    for client in list(dashboard_clients):
        try:
            await client.send(msg)
        except Exception:
            pass


async def _send_to_all_glasses(text: str) -> int:
    """Send plain text to all connected glasses. Returns the number of successful sends."""
    count = 0
    for client in list(glasses_clients):
        try:
            await client.send(text)
            count += 1
        except Exception:
            pass
    return count


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------
async def handler(websocket: ServerConnection) -> None:
    """Coroutine called for each new connection. Role is determined dynamically by message type."""
    addr = websocket.remote_address
    role = "unknown"
    log.info(f"[{addr}] Connection established")

    try:
        async for raw in websocket:
            if not isinstance(raw, str):
                continue  # ignore binary frames

            # ---- parse JSON message ----
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # plain text -> treat as direct text from Dashboard and forward to glasses
                text = raw.strip()
                if text:
                    sent = await _send_to_all_glasses(text)
                    log.info(f"[{addr}] Forwarded plain text to {sent} glasses: {text!r}")
                continue

            msg_type = data.get("type", "")

            # ---- connect: glasses client announces itself on open ----
            if msg_type == "connect":
                if role == "unknown":
                    role = "glasses"
                    glasses_clients.add(websocket)
                    log.info(f"[{addr}] Registered as glasses client (via connect)")
                    await _broadcast_status()

            # ---- glasses-input: input event from glasses ----
            elif msg_type == "glasses-input":
                if role == "unknown":
                    role = "glasses"
                    glasses_clients.add(websocket)
                    log.info(f"[{addr}] Registered as glasses client (via glasses-input)")
                    await _broadcast_status()

                event_name = data.get("event", "unknown")
                log.info(f"[{addr}] Glasses event: {event_name}")

                # forward to all Dashboards
                for client in list(dashboard_clients):
                    try:
                        await client.send(raw)
                    except Exception:
                        pass

            # ---- register: register a Dashboard client ----
            elif msg_type == "register":
                if role == "unknown":
                    role = "dashboard"
                    dashboard_clients.add(websocket)
                    log.info(f"[{addr}] Registered as Dashboard client")
                await _broadcast_status()

            # ---- send-text: Dashboard → send text to glasses ----
            elif msg_type == "send-text":
                # register as Dashboard on first send-text
                if role == "unknown":
                    role = "dashboard"
                    dashboard_clients.add(websocket)
                    log.info(f"[{addr}] Registered as Dashboard client (via send-text)")
                    await _broadcast_status()

                text = str(data.get("text", "")).strip()
                if text:
                    sent = await _send_to_all_glasses(text)
                    log.info(f"[{addr}] Sent to {sent} glasses: {text!r}")
                    ack = json.dumps({"type": "send-ack", "text": text, "sent_to": sent})
                    try:
                        await websocket.send(ack)
                    except Exception:
                        pass
                else:
                    log.warning(f"[{addr}] send-text: empty text, ignored")

            else:
                log.warning(f"[{addr}] Unknown message type: {msg_type!r}")

    except websockets.exceptions.ConnectionClosedError:
        pass
    except websockets.exceptions.ConnectionClosedOK:
        pass
    finally:
        if role == "glasses":
            glasses_clients.discard(websocket)
            log.info(f"[{addr}] Glasses client disconnected")
        elif role == "dashboard":
            dashboard_clients.discard(websocket)
            log.info(f"[{addr}] Dashboard client disconnected")
        else:
            log.info(f"[{addr}] Unclassified client disconnected")
        await _broadcast_status()


# ---------------------------------------------------------------------------
# HTTP server (serves Dashboard UI static files)
# ---------------------------------------------------------------------------
def _serve_http() -> None:
    """Thread function that serves static files from the ws/ directory over HTTP."""
    base_dir = Path(__file__).parent

    class _Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(base_dir), **kwargs)

        def log_message(self, fmt, *args):  # type: ignore[override]
            log.info(f"HTTP  {self.address_string()}  {fmt % args}")

    httpd = HTTPServer(("0.0.0.0", HTTP_PORT), _Handler)
    log.info(f"Dashboard UI: http://0.0.0.0:{HTTP_PORT}/index.html")
    httpd.serve_forever()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def _main() -> None:
    # Start HTTP server in a daemon thread
    t = threading.Thread(target=_serve_http, daemon=True)
    t.start()

    log.info(f"WebSocket server: ws://{WS_HOST}:{WS_PORT}")
    log.info("Set the above WS address as the 'WebSocket URL' in the G2 glasses app.")
    log.info("Press Ctrl+C to stop.")

    async with websockets.serve(handler, WS_HOST, WS_PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        log.info("Server stopped.")

/**
 * main.ts — G2 glasses-side logic
 *
 * This module runs inside a Flutter WebView hosted by the Even Hub companion app.
 * It communicates with the G2 glasses through the EvenAppBridge provided by the SDK.
 *
 * Execution order required by the SDK:
 *   1. waitForEvenAppBridge()           — wait for the native bridge to become ready
 *   2. createStartUpPageContainer()     — MUST be called exactly once at startup
 *   3. textContainerUpgrade() / etc.    — all other API calls come after step 2
 *
 * G2 display specs:
 *   - Resolution : 576 × 288 px
 *   - Color depth: 4-bit greyscale (values 0–15, displayed as shades of green)
 *   - No camera, no speaker
 */

import { waitForEvenAppBridge, TextContainerProperty, CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, OsEventTypeList } from '@evenrealities/even_hub_sdk'

// ---------------------------------------------------------------------------
// Console log interception
// ---------------------------------------------------------------------------
// Override console.log / .warn / .error so that output is also appended to the
// #console-output element in the WebView, making logs visible on-device.
// The original functions are preserved so DevTools output continues to work.
const _origLog = console.log.bind(console)
const _origWarn = console.warn.bind(console)
const _origError = console.error.bind(console)

/**
 * Append a log line to #console-output.
 * @param level Log level ('log' | 'warn' | 'error')
 * @param args  Arguments to display — objects are JSON-stringified
 */
function appendLog(level: 'log' | 'warn' | 'error', args: unknown[]) {
  const el = document.querySelector<HTMLDivElement>('#console-output')
  if (!el) return
  const line = document.createElement('div')
  // Text colour by level: error=red / warn=yellow / log=green
  const color = level === 'error' ? '#f66' : level === 'warn' ? '#fa0' : '#cfc'
  line.style.cssText = `color:${color};font-size:12px;border-bottom:1px solid #333;padding:2px 0;word-break:break-all;`
  line.textContent = `[${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`
  el.appendChild(line)
  // Auto-scroll to keep the latest log visible
  el.scrollTop = el.scrollHeight
}

// Forward to original handler, then append to screen.
// Skip SDK-internal debug lines starting with '[EvenAppBridge]' or '[Simulator]'.
console.log = (...args) => {
  _origLog(...args)
  if (args.length > 0 && typeof args[0] === 'string' && (args[0].startsWith('[EvenAppBridge]') || args[0].startsWith('[Simulator]'))) return
  appendLog('log', args)
}
console.warn = (...args) => { _origWarn(...args); appendLog('warn', args) }
console.error = (...args) => { _origError(...args); appendLog('error', args) }

// Wait for the native bridge to be injected by the Even Hub host app.
// This must always be the first SDK call. Do NOT call any other bridge method before this resolves.
const bridge = await waitForEvenAppBridge()

// Key used to persist the last displayed text in the companion app's local storage.
// bridge.setLocalStorage / getLocalStorage are simple key-value string stores.
const STORAGE_KEY = 'g2_lastText'

// Auto-clear: key and runtime state.
// Declared here (near the bridge init) so the value can be restored before any sends occur
// and so the control functions (_w.setAutoClear / _w.clearAutoClear) can be exposed early.
const AUTO_CLEAR_KEY = 'g2_autoClearMs'
let autoClearMs = 0                                            // 0 = disabled
let autoClearTimer: ReturnType<typeof setTimeout> | null = null

// Restore the last text sent to the glasses.
// Returns an empty string if the key does not exist yet.
let savedText: string = await bridge.getLocalStorage(STORAGE_KEY)

if(savedText.length < 1) {
  savedText = 'Hello World'
}

// Notify the Web UI of the restored text so the input field can be pre-filled.
window.dispatchEvent(new CustomEvent('glasses-text-restored', { detail: { savedText } }))

// Restore auto-clear delay from SDK storage.
// Must run early (before createStartUpPageContainer) so autoClearMs is active from the
// very first send, and the UI is updated before the user can interact with the Set button.
const savedAutoClearMs = parseInt(await bridge.getLocalStorage(AUTO_CLEAR_KEY), 10)
if (!isNaN(savedAutoClearMs) && savedAutoClearMs > 0) {
  autoClearMs = savedAutoClearMs
  console.log(`[AutoClear] Restored: ${autoClearMs}ms`)
  window.dispatchEvent(new CustomEvent('auto-clear-restored', { detail: { ms: autoClearMs } }))
}

// Define the single text container that fills the entire G2 display (576 × 288).
// G2 notes:
//   - containerID must be a unique integer per container on the page.
//   - containerName must be ≤ 16 characters.
//   - Exactly ONE container per page must have isEventCapture = 1.
//     This container receives all touchpad/scroll events from the glasses.
//   - color values are greyscale indices 0–15 (0 = black, 15 = brightest green).
//   - content is limited to 1000 characters for createStartUpPageContainer;
//     textContainerUpgrade allows up to 2000 characters per call.
const mainText = new TextContainerProperty({
  xPosition: 0,       // left edge of display
  yPosition: 0,       // top edge of display
  width: 576,         // full display width
  height: 288,        // full display height
  borderWidth: 0,
  borderColor: 2,     // dark grey border
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: savedText || 'Hello World',  // restore last text, or show default
  isEventCapture: 1,  // this container captures all G2 touchpad/scroll input
})

// Create the startup page. This MUST be called exactly once after bridge init.
// Return values: 0 = success, 1 = invalid params, 2 = oversize, 3 = out of memory
// G2 note: if the container is already displayed (e.g. on reconnect), this call
// may fail. In that case fall back to textContainerUpgrade to update the content.
const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
  containerTotalNum: 1,   // total number of containers on this page (must match actual count)
  textObject: [mainText],
}))
console.log('Page created:', result === 0 ? 'success' : 'failed')

// Fallback: if createStartUpPageContainer failed, the glasses may already have a page from a
// previous session. Rebuild all containers from scratch using rebuildPageContainer, which tears
// down the existing page and redraws it.
if (result !== 0) {
  console.log('createStartUpPageContainer failed, falling back to rebuildPageContainer')
  mainText.content = savedText || 'Hello World'
  const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }))
  console.log('Page rebuilt:', rebuilt ? 'success' : 'failed')
}

// Start the auto-clear timer for the initial display.
// createStartUpPageContainer / rebuildPageContainer bypass dispatchUpgrade(), so
// we manually arm the timer here if a delay has been restored from storage.
if (autoClearMs > 0) {
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null }
  autoClearTimer = setTimeout(async () => {
    autoClearTimer = null
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1,
      content: ' ',
    }))
    window.dispatchEvent(new CustomEvent('glasses-auto-cleared'))
  }, autoClearMs)
}

// ---------------------------------------------------------------------------
// Throttled text update
// ---------------------------------------------------------------------------
// G2 note: sending updates too frequently can overwhelm the BLE channel.
// We enforce a minimum interval of THROTTLE_MS between actual sends.
// If a new value arrives during the cooldown, it is queued and sent once the
// cooldown expires — always sending the latest value, never intermediate ones.

const THROTTLE_MS = 100        // minimum milliseconds between sends
let lastSentAt = 0              // timestamp of the last successful send
let pendingText: string | null = null          // text queued during cooldown
let throttleTimer: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Auto-clear timer
// ---------------------------------------------------------------------------
// If autoClearMs > 0, the glasses display is overwritten with a single space
// character after this many milliseconds following each send.
// A single space is required because G2 does not accept empty content strings.
// The textarea is NOT affected — only the glasses display is cleared.
// (AUTO_CLEAR_KEY, autoClearMs, autoClearTimer are declared above near STORAGE_KEY)

/**
 * Actually send the text to the glasses and persist it.
 * Uses textContainerUpgrade for in-place update without a full page redraw.
 * Also saves to SDK storage so the text survives app restarts.
 */
async function dispatchUpgrade(text: string): Promise<void> {
  lastSentAt = Date.now()
  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    content: text,
  }))
  // Persist the sent text so it can be restored on next launch.
  await bridge.setLocalStorage(STORAGE_KEY, text)
  // Notify the Web UI that the send completed.
  window.dispatchEvent(new CustomEvent('glasses-sent', { detail: { text } }))

  // Reset auto-clear timer. A new send always cancels any previous clear schedule.
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null }
  if (autoClearMs > 0) {
    autoClearTimer = setTimeout(async () => {
      autoClearTimer = null
      // Overwrite the glasses display with a single space to blank it out.
      // G2 does not accept empty strings, so a space character is the minimum.
      // Storage and the textarea are intentionally NOT updated here.
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        content: ' ',
      }))
      window.dispatchEvent(new CustomEvent('glasses-auto-cleared'))
    }, autoClearMs)
  }
}

/**
 * Public entry point called from index.html.
 * Sends text to the glasses, throttled to at most once per THROTTLE_MS.
 * If called during a cooldown, the latest text is queued and sent when ready.
 */
async function sendToGlasses(text: string): Promise<void> {
  const elapsed = Date.now() - lastSentAt
  if (elapsed >= THROTTLE_MS) {
    // Cooldown has passed — send immediately.
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null }
    pendingText = null
    await dispatchUpgrade(text)
  } else {
    // Still in cooldown — queue the latest text.
    pendingText = text
    window.dispatchEvent(new CustomEvent('glasses-pending'))
    if (!throttleTimer) {
      // Schedule a send for when the cooldown expires.
      throttleTimer = setTimeout(async () => {
        throttleTimer = null
        if (pendingText !== null) {
          const t = pendingText
          pendingText = null
          await dispatchUpgrade(t)
        }
      }, THROTTLE_MS - elapsed)
    }
    // If a timer is already running, it will pick up the updated pendingText automatically.
  }
}

// Shared typed reference to window for all exposed functions.
// Defined here so _w.setAutoClear / _w.clearAutoClear are available as soon as
// the bridge is ready (early in the init sequence), not blocked behind WebSocket setup.
const _w = window as unknown as Record<string, unknown>
_w.sendToGlasses = sendToGlasses

// Expose clearStorage: wipes the saved text from SDK storage and clears the input field.
_w.clearStorage = async () => {
  await bridge.setLocalStorage(STORAGE_KEY, '')
  window.dispatchEvent(new CustomEvent('storage-cleared'))
}

// Expose auto-clear controls early so the Set button works immediately after bridge init.
// setAutoClear: set the delay in ms. Pass 0 to disable.
_w.setAutoClear = async (ms: number) => {
  autoClearMs = ms > 0 ? ms : 0
  if (autoClearTimer && autoClearMs === 0) { clearTimeout(autoClearTimer); autoClearTimer = null }
  await bridge.setLocalStorage(AUTO_CLEAR_KEY, String(autoClearMs))
  window.dispatchEvent(new CustomEvent('auto-clear-changed', { detail: { ms: autoClearMs } }))
}

// clearAutoClear: disable and cancel any pending clear timer.
_w.clearAutoClear = async () => {
  autoClearMs = 0
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null }
  await bridge.setLocalStorage(AUTO_CLEAR_KEY, '0')
  window.dispatchEvent(new CustomEvent('auto-clear-changed', { detail: { ms: 0 } }))
}

// ---------------------------------------------------------------------------
// G2 input event listener
// ---------------------------------------------------------------------------
// onEvenHubEvent fires for every event coming from the glasses:
//   textEvent  — interaction on a text container (tap, scroll, etc.)
//   listEvent  — interaction on a list container
//   sysEvent   — system-level signals (IMU data, app lifecycle)
//   audioEvent — PCM audio frames (only when audioControl(true) is active)
//
// G2 touchpad gesture → OsEventTypeList mapping:
//   Single tap      → CLICK_EVENT        (eventType = 0)
//   Double tap      → DOUBLE_CLICK_EVENT  (eventType = 3)
//   Swipe up        → SCROLL_TOP_EVENT    (eventType = 1)  * see note below
//   Swipe down      → SCROLL_BOTTOM_EVENT (eventType = 2)  * see note below
//
// NOTE: SCROLL_TOP_EVENT and SCROLL_BOTTOM_EVENT do NOT fire on every swipe.
// They only fire when the content has reached the scroll boundary (top or bottom edge).
// In other words, these are "hit the end" events, not continuous scroll events.
//
// NOTE: In practice, CLICK_EVENT (tap) often arrives with eventType = undefined
// on the textEvent object. Treating undefined as a tap is the correct workaround.
bridge.onEvenHubEvent((event) => {
  // Prefer textEvent, fall back to listEvent, then sysEvent.
  const et = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType

  let name: string
  switch (et) {
    // eventType is undefined for tap on text containers — treat as tap.
    case undefined:                           name = 'tap';           break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:  name = 'double-tap';    break
    case OsEventTypeList.SCROLL_TOP_EVENT:    name = 'scroll-up';     break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: name = 'scroll-down';   break
    // Lifecycle events fired by the G2 host when the app is terminated unexpectedly.
    case OsEventTypeList.ABNORMAL_EXIT_EVENT: name = 'abnormal-exit'; break
    // Lifecycle event fired when the system (companion app) exits the glasses app normally.
    case OsEventTypeList.SYSTEM_EXIT_EVENT:   name = 'system-exit';   break
    default: return  // ignore FOREGROUND_ENTER/EXIT, IMU_DATA_REPORT, etc.
  }

  // Relay the event to index.html for visualization.
  window.dispatchEvent(new CustomEvent('glasses-input', { detail: { name } }))

  // Also forward glasses input events to the WebSocket server as JSON.
  wsSend(JSON.stringify({ type: 'glasses-input', event: name, timestamp: Date.now() }))
})

// ---------------------------------------------------------------------------
// WebSocket client
// ---------------------------------------------------------------------------
// Receives text messages from a remote server and sends them to the glasses.
// G2 input events are forwarded to the server as JSON.
//
// Protocol (text frames only):
//   Server → Client: plain text string → displayed on glasses + textbox
//   Client → Server: JSON { type: 'glasses-input', event: string, timestamp: number }
//
// Reconnection uses exponential backoff capped at 30 s.

const WS_URL_KEY = 'g2_wsUrl'
const WS_BACKOFF_BASE = 1000   // initial retry delay in ms
const WS_BACKOFF_MAX  = 30000  // maximum retry delay in ms

let ws: WebSocket | null = null
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null
let wsBackoff = WS_BACKOFF_BASE
let wsIntentionalClose = false  // true when user explicitly disconnects

/** Send a message if the socket is open. */
function wsSend(data: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
}

/** Update the connection status badge in the UI. */
function wsSetStatus(status: 'connected' | 'connecting' | 'disconnected', detail = ''): void {
  window.dispatchEvent(new CustomEvent('ws-status', { detail: { status, detail } }))
}

/** Open a WebSocket connection to the given URL. */
function wsConnect(url: string): void {
  if (ws) { wsIntentionalClose = true; ws.close(); ws = null }
  wsIntentionalClose = false
  wsSetStatus('connecting', url)
  console.log(`[WS] Connecting to ${url}`)

  try {
    ws = new WebSocket(url)
  } catch (e) {
    console.error('[WS] Invalid URL:', e)
    wsSetStatus('disconnected', 'Invalid URL')
    return
  }

  ws.addEventListener('open', () => {
    wsBackoff = WS_BACKOFF_BASE  // reset backoff on successful connection
    console.log('[WS] Connected')
    wsSetStatus('connected', url)
    // Notify the server that the client has connected.
    wsSend(JSON.stringify({ type: 'connect', timestamp: Date.now() }))
  })

  ws.addEventListener('message', (ev) => {
    const text = typeof ev.data === 'string' ? ev.data.trim() : ''
    if (!text) return
    console.log('[WS] Received:', text)
    // Update the textbox in the UI.
    window.dispatchEvent(new CustomEvent('ws-text-received', { detail: { text } }))
    // Send to glasses via the same throttled path used by the manual input.
    sendToGlasses(text)
  })

  ws.addEventListener('close', (ev) => {
    ws = null
    if (wsIntentionalClose) {
      console.log('[WS] Disconnected (user request)')
      wsSetStatus('disconnected')
      return
    }
    console.warn(`[WS] Connection closed (code ${ev.code}). Retrying in ${wsBackoff / 1000}s…`)
    wsSetStatus('connecting', `Retry in ${wsBackoff / 1000}s…`)
    wsRetryTimer = setTimeout(() => {
      wsBackoff = Math.min(wsBackoff * 2, WS_BACKOFF_MAX)
      wsConnect(url)
    }, wsBackoff)
  })

  ws.addEventListener('error', () => {
    console.error('[WS] Connection error')
    // The 'close' event will fire immediately after and handle retry.
  })
}

/** Disconnect and cancel any pending retry. */
function wsDisconnect(): void {
  if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null }
  wsIntentionalClose = true
  if (ws) { ws.close(); ws = null }
  wsSetStatus('disconnected')
  console.log('[WS] Disconnected')
}

// Restore saved WebSocket URL and auto-connect if present.
const savedWsUrl: string = await bridge.getLocalStorage(WS_URL_KEY)
if (savedWsUrl) {
  console.log('[WS] Auto-connecting to saved URL:', savedWsUrl)
  window.dispatchEvent(new CustomEvent('ws-url-restored', { detail: { url: savedWsUrl } }))
  wsConnect(savedWsUrl)
}

// Expose WebSocket controls to the non-module scripts in index.html.
// _w is already defined above (near sendToGlasses).
_w.wsConnect = async (url: string) => {
  await bridge.setLocalStorage(WS_URL_KEY, url)
  wsConnect(url)
}
_w.wsDisconnect = wsDisconnect
_w.wsClearUrl = async () => {
  wsDisconnect()
  await bridge.setLocalStorage(WS_URL_KEY, '')
  window.dispatchEvent(new CustomEvent('ws-url-cleared'))
}

// (auto-clear restore, setAutoClear, clearAutoClear are defined earlier near sendToGlasses)


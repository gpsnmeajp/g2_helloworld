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

import { waitForEvenAppBridge, TextContainerProperty, CreateStartUpPageContainer, TextContainerUpgrade, OsEventTypeList } from '@evenrealities/even_hub_sdk'

// Wait for the native bridge to be injected by the Even Hub host app.
// This must always be the first SDK call. Do NOT call any other bridge method before this resolves.
const bridge = await waitForEvenAppBridge()

// Key used to persist the last displayed text in the companion app's local storage.
// bridge.setLocalStorage / getLocalStorage are simple key-value string stores.
const STORAGE_KEY = 'g2_lastText'

// Restore the last text sent to the glasses.
// Returns an empty string if the key does not exist yet.
const savedText: string = await bridge.getLocalStorage(STORAGE_KEY)

// Notify the Web UI that the bridge is ready.
// index.html listens for this event to hide the QR section and show the control UI.
// bridge.ready is true once waitForEvenAppBridge() has resolved.
if (bridge != null && bridge.ready) {
  window.dispatchEvent(new CustomEvent('glasses-ready', { detail: { savedText } }))
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
  borderWidth: 1,
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

// Fallback: if createStartUpPageContainer failed and we have saved text,
// try to update the existing container in-place with textContainerUpgrade.
// This can happen when the page reloads while the glasses still have the previous container.
if (result !== 0 && savedText) {
  console.log('createStartUpPageContainer failed, falling back to textContainerUpgrade')
  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    content: savedText,
  }))
}

// ---------------------------------------------------------------------------
// Throttled text update
// ---------------------------------------------------------------------------
// G2 note: sending updates too frequently can overwhelm the BLE channel.
// We enforce a minimum interval of THROTTLE_MS between actual sends.
// If a new value arrives during the cooldown, it is queued and sent once the
// cooldown expires — always sending the latest value, never intermediate ones.

const THROTTLE_MS = 2000        // minimum milliseconds between sends
let lastSentAt = 0              // timestamp of the last successful send
let pendingText: string | null = null          // text queued during cooldown
let throttleTimer: ReturnType<typeof setTimeout> | null = null

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

// Expose sendToGlasses to the non-module script in index.html.
// window is typed as Record<string, unknown> to satisfy TypeScript strict mode.
;(window as unknown as Record<string, unknown>).sendToGlasses = sendToGlasses

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
})


# g2_helloworld

**A sideload app demo for Even Realities G2 smart glasses**

**Author:** gpsnmeajp  
**License:** Unlicense

Demo(QR Code): https://sabowl.sakura.ne.jp/g2/helloworld/

![screenshot](image.png)

---

## Purpose

- **Working demo** of a G2 glasses app
- **Sideload app demo** deployable to any web server
- **Beginner sample** for getting started with the Even Hub SDK
- **Quick way to display arbitrary text** on the G2 display for rapid testing

---

## Features

- **Auto-generated QR code** — Opens with a QR code of its own URL. Scan it from the Even Hub companion app to sideload instantly
- **Text sender** — Send any text from the Web UI to the G2 display (throttled to a minimum 2-second interval)
- **Last input restore** — Saves the last sent text to SDK storage and re-displays it automatically on next launch
- **Input event visualizer** — Tap, double-tap, scroll up/down, abnormal exit, and system exit events are shown in real time on the Web UI
- **UI switch on bridge connect** — Once the app is successfully loaded on the glasses, the QR section hides and the control UI appears

---

## Requirements

- [Even Realities G2 smart glasses](https://www.evenrealities.com/)
- Even app (iOS / Android)
- [Even Hub **developer account**](https://hub.evenrealities.com/)
- Node.js 18+
- PC and glasses on the **same Wi-Fi network**

---

## Setup

```bash
npm install
```

---

## Development

```bash
npm run dev
```

Vite starts a server at `http://localhost:5173` (or the next available port).

Open `http://<your LAN IP>:5173` in a browser to see the QR code, then scan it with the Even Hub app to sideload.

---

## Build

```bash
npm run build
```

Output goes to `dist/`. Deploy it to any static web server.

Base url config in package.json

`"build": "tsc && vite build --base=/g2/helloworld/",`

---

## Sideload Steps

1. Register a developer account on Even Hub
2. Open the Even Hub app → tap the top-right icon → **My plugin** → tap your name → enable **Prototype mode**
3. Run `npm run dev`
4. Open `http://<your LAN IP>:5173` in a browser
5. Scan the displayed QR code with the Even Hub app

---

## Usage

| Action | Result |
|---|---|
| Type in the textarea → **Ctrl+Enter** | Send text to the G2 display |
| **Enter** | New line in the textarea |
| Operate the glasses touchpad | Shown in real time on the event monitor |

---

## Project Structure

```
g2_helloworld/
  app.json          Even Hub app manifest
  index.html        QR code, text sender, and event monitor UI
  src/
    main.ts         Even Hub SDK integration and glasses-side logic
  package.json
  tsconfig.json
```

---

## Tech Stack

- [Vite](https://vite.dev/) + TypeScript
- [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)
- [@evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli)
- [@evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)

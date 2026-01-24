# Headless VM Setup

How to run Bice Box on a headless VM (no physical display).

## Prerequisites

- **Xvfb** (X Virtual Framebuffer) installed
- **Node.js** and **npm** installed
- Dependencies installed via `npm install`

## Setting Up the Virtual Display

Bice Box requires a display to render its Electron/React UI. On headless VMs, use Xvfb to create a virtual framebuffer.

### Start Xvfb (if not already running)

```bash
Xvfb :99 -screen 0 1280x720x24 &
```

### Set the DISPLAY Environment Variable

```bash
export DISPLAY=:99
```

### Verify the Display

```bash
xdpyinfo | head -5
```

You should see output indicating display `:99` is available.

## Running the Application

```bash
cd ~/src/bice-box
export DISPLAY=:99
npm run dev
```

This starts:
- React dev server on port 3000
- Electron app connecting to the dev server

## Capturing Screenshots

Since there's no physical display, capture the virtual framebuffer:

```bash
import -window root screenshot.png
```

## Known Limitations

- **Audio unavailable**: SuperCollider and JACK audio will fail without audio hardware. This is expected on VMs.
- **No direct visibility**: The GUI renders on the virtual display but can't be viewed directly. Use screenshots or VNC to inspect.
- **Performance**: Software rendering may be slower than GPU-accelerated displays.

## Quick Start

```bash
export DISPLAY=:99 && cd ~/src/bice-box && npm run dev
```

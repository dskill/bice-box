# CLAUDE.md - Bice-Box

Audiovisual effects processor: live audio in → processed audio + synchronized visuals out. Built for Raspberry Pi, runs on Mac for development.

## Architecture

```
┌─────────────────┐     OSC      ┌─────────────────┐
│  SuperCollider  │◄────────────►│    Electron     │
│  (Audio Engine) │              │  (Orchestrator) │
└─────────────────┘              └────────┬────────┘
                                          │ IPC
                                 ┌────────▼────────┐
                                 │      React      │
                                 │  (UI + Visuals) │
                                 └─────────────────┘
```

**Why SuperCollider as separate process?**
- Real-time audio DSP with <10ms latency (Web Audio can't match this)
- Hot-swap effects without app restart - load new `.sc` files on the fly
- Battle-tested audio engine used in professional music production
- Vast ecosystem of synthesis algorithms and audio analysis tools
- Process isolation: audio keeps running if UI crashes
- Direct hardware access: MIDI controllers talk straight to SC, bypassing UI latency

**External control (MIDI, OSC, hardware):**
```
MIDI Controller ──► SuperCollider ──► OSC broadcast ──► Electron ──► React UI
                    (instant audio)                     (UI updates reflect changes)
```
Controllers bypass the app entirely for zero-latency audio response. SC broadcasts parameter changes back, keeping UI faders in sync. This means physical knobs feel instant while the UI follows.

**Layer responsibilities:**
- **SuperCollider**: All audio processing, FFT analysis, parameter control
- **Electron**: Process management, OSC bridge, file system, MCP server
- **React**: Touch UI, GLSL/p5.js visualizers, parameter faders

## Repos
- **Main App**: `/Users/drew/src/bice-box` - Electron/React
- **Effects**: `/Users/drew/bice-box-effects` - Has its own CLAUDE.md with MCP tools and skills

## Commands
- `npm run dev` - Development with hot reloading
- `npm run build:electron` - Build for Mac
- `npm run build:electron:pi` - Build for Raspberry Pi (arm64)

## Release
```bash
npm run release:patch:ci   # Bump version, commit, push with tags
npm run release:publish    # Build arm64 and publish to GitHub
```

## Code Style
- Function components with hooks, 2-space indent, single quotes
- camelCase variables/functions, PascalCase components
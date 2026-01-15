# Bice-Box UI Documentation

## Target Display

- **Resolution**: 800x480 pixels
- **Device**: Raspberry Pi with official 7" touchscreen (or similar)
- **Input**: Touch-first (no mouse/hover states relied upon)
- **Orientation**: Landscape

## Design Goals

### Synthwave Aesthetic
The UI uses a retro/synthwave color palette to match the audio-reactive visualizations:

```css
--synth-bg: #0a0a0f;           /* Near-black background */
--synth-bg-secondary: #12121a;  /* Slightly lighter panels */
--synth-cyan: #00ffff;          /* Selected categories, tabs */
--synth-magenta: #ff00ff;       /* Selected effects, headers */
```

The neon cyan and magenta colors provide visual hierarchy:
- **Cyan** = Navigation/categories (where you are)
- **Magenta** = Content/effects (what you're selecting)

### Touch-First Design
- Minimum touch target: **44px** (Apple HIG recommendation)
- Effect items: **50px+** height with 14px padding
- Category items: **48px+** height
- Large, easily tappable buttons

### Scalability
Designed to handle **1000+ effects** efficiently:
- Two-column layout keeps categories always visible for quick navigation
- Search filters across ALL effects instantly
- Native browser scrolling for performance

## Pi-Specific Optimizations

### NO GPU Effects
The Pi's GPU is dedicated to rendering audio-reactive shaders and visualizations. CSS GPU operations compete for these resources and cause lag.

**Removed/Avoided:**
- `text-shadow` - Blur requires GPU compositing
- `box-shadow` - Blur requires GPU compositing
- `transform: translateZ(0)` - Forces GPU layer creation
- `will-change` - Creates GPU compositing layers
- `filter: blur()` - GPU-intensive
- Complex `linear-gradient` - Can trigger GPU
- CSS animations on transforms/opacity

**Safe to use (CPU-rendered):**
- Solid `color` values
- Solid `background-color` / `rgba()` fills
- `border` properties
- Simple state changes (no transitions on heavy properties)

### Native Scrolling
Instead of custom JavaScript touch handling, we use native browser scrolling:
```css
overflow-y: auto;
-webkit-overflow-scrolling: touch;  /* Momentum scrolling on mobile */
scrollbar-width: none;              /* Hide scrollbars */
```

This leverages the browser's optimized scroll implementation rather than fighting it.

## Effect Selection Screen Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [AUDIO]  [Visual]                         [Search...]      │  50px header
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────┐  ┌─────────────────────────────────────────┐ │
│  │ Delay    2│  │  DISTORTION              13 effects     │ │
│  │ Distort 13│  │ ─────────────────────────────────────── │ │
│  │►Filter   5│  │  Baxandall Distortion                   │ │
│  │ Modula  16│  │  Baxandall EQ with tanh drive...        │ │
│  │ Pitch    4│  │ ─────────────────────────────────────── │ │
│  │ Reverb   1│  │  Bit Crusher                            │ │
│  │ Utility  3│  │  Bitcrusher with sample-rate...         │ │
│  │           │  │ ─────────────────────────────────────── │ │
│  │           │  │  Boss DS1                               │ │
│  │           │  │  Boss DS-1 Distortion emulation...      │ │
│  └───────────┘  └─────────────────────────────────────────┘ │
│     160px                    ~640px                         │
└─────────────────────────────────────────────────────────────┘
```

## Testing with Playwright MCP

### Setup
Playwright MCP allows Claude to control browsers and Electron apps for visual testing and iteration.

The MCP configuration is stored in `.mcp.json` in the project root (version controlled). Claude Code automatically loads this when working in the project.

**To manually add/update (if needed):**
```bash
claude mcp add --scope project playwright -- npx '@playwright/mcp@latest' --cdp-endpoint http://localhost:9222
```

2. **Start app with remote debugging:**
   ```bash
   npm run dev:debug
   ```
   This runs Electron with `--remote-debugging-port=9222`, exposing Chrome DevTools Protocol.

3. **Claude connects via CDP** and can:
   - Navigate the app
   - Click buttons and interact with UI
   - Take screenshots to verify visual changes
   - Read accessibility snapshots of the DOM

### Iteration Workflow
The workflow used to develop the effect selection screen:

1. **Take screenshot** - See current state
   ```
   mcp__playwright__browser_take_screenshot
   ```

2. **Read accessibility snapshot** - Understand DOM structure
   ```
   mcp__playwright__browser_snapshot
   ```

3. **Make code changes** - Edit component/CSS files

4. **Hot reload** - React dev server auto-updates

5. **Take new screenshot** - Verify changes visually

6. **Click/interact** - Test functionality
   ```
   mcp__playwright__browser_click
   ```

7. **Resize viewport** - Test at target resolution (800x480)
   ```
   mcp__playwright__browser_resize
   ```

### Example Session
```
# Resize to Pi resolution
browser_resize(800, 480)

# Navigate to effect selector
browser_click("bypass button")

# Take screenshot to see layout
browser_take_screenshot("effect-select-v1.png")

# Test search
browser_type("Search input", "fuzz")
browser_take_screenshot("search-results.png")

# Click a category
browser_click("Distortion category")
browser_take_screenshot("distortion-effects.png")
```

### Benefits
- **Visual verification** - See exactly what users see
- **Rapid iteration** - Change CSS, screenshot, repeat
- **Touch simulation** - Click events work like touch
- **Resolution testing** - Resize to exact Pi dimensions
- **No manual testing** - AI can verify its own changes

## Files

- `src/EffectSelectScreen.js` - Main component (~260 lines)
- `src/App.css` - Styles including effect-select section (~300 lines)
- `package.json` - Contains `dev:debug` script for Playwright testing
- `.mcp.json` - Playwright MCP config for Claude Code (version controlled)
- `.playwright-mcp/` - Screenshot output directory (gitignored)

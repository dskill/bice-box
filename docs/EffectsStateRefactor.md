## Effects/Params Architecture Refactor Plan

### Goals
- Unify all effect state and parameter updates through a single source of truth (SSOT) in the Electron main process.
- Make UI and MCP symmetrical clients: both call the same actions, both subscribe to the same state updates.
- Eliminate race conditions and double-sends to SuperCollider (SC).
- Clearly separate parameter specifications (min/max/default) from live values.
- Make initialization/activation idempotent and predictable.

### Problems Today (to remove)
- Multiple writers to SC (UI and various code paths) cause value “ping-pong” (e.g., default overwriting MCP-set).
- Listeners accumulate (duplicates), causing repeated updates.
- `params` conflates specs with live values; unclear ownership of live state.
- UI pushes defaults opportunistically; main also pushes, creating races.
- MCP writes aren’t always reflected in the same canonical structure the UI reads.

### Target Architecture (single source of truth)
Maintain the entire effects state in the main process. UI and MCP send Actions; main applies them, updates SC, and broadcasts authoritative State.

#### Canonical Data Model (main process)
```ts
type ParamSpec = {
  minval: number;
  maxval: number;
  warp: string;       // e.g., 'linear'
  step: number;
  default: number;
  units?: string;
};

type EffectState = {
  name: string;
  scFilePath: string;
  paramSpecs: Record<string, ParamSpec>; // immutable spec
  paramValues: Record<string, number>;    // live values (authoritative)
};

type EffectsStore = {
  byName: Record<string, EffectState>;
  activeEffectName: string | null;
};
```

Notes:
- Keep `paramSpecs` separate from `paramValues`.
- Optionally export a legacy alias `params -> paramSpecs` during a migration window for renderer compatibility.

### Actions (UI and MCP call the same)
- `set_current_effect({ name })`
  - Sets `activeEffectName` in the store.
  - Loads SC file if needed.
  - Applies `paramValues` to SC (not defaults) once specs are available.
- `set_effect_parameters({ name?, params })`
  - If `name` omitted, target the active effect.
  - Validate keys against `paramSpecs`; clamp to ranges.
  - Update `paramValues` in the store, push to SC exactly once per change, then broadcast state.
- `get_current_effect()`
  - Returns `{ name, scFilePath, paramSpecs, paramValues }` for the active effect.
- `list_effects()`
- `get_visualizers()/set_visualizer(...)` (symmetry for visuals, same pattern).

### Events (main -> UI/MCP)
- `effects-state` (full or partial update)
  - At least include `{ activeEffectName, effect: { name, paramSpecs, paramValues } }` for the active effect.
- `effect-updated` (targeted diff update)
  - For hot paths (e.g., param tweak), send minimal payload: `{ name, paramValuesDelta }`.

### SC Bridge (single writer)
- Only the main process writes to SC.
- Standardize on OSC route `/effect/param/set` with args: `['paramName'(s), value(f)]` to the SC language port discovered at boot.
- When `activeEffectName` changes or specs arrive, the main applies `paramValues` (not defaults) to SC once.
- Debounce/coalesce rapid UI changes (optional) to minimize OSC traffic (e.g., 16ms throttle).

### Initialization & Activation Flow
1. App start:
   - Main boots SC (init.sc), waits for `/sc/config` with ports, then loads effects list.
2. Specs discovery:
   - After loading an SC file for the active effect, main requests/receives `paramSpecs`.
   - Initialize `paramValues` lazily: only set a key = spec.default if missing.
3. Apply to SC:
   - Main sends `paramValues` to SC (once) after specs are known or on activation change.
4. Broadcast:
   - Main emits `effects-state` to UI/MCP.
5. UI render:
   - UI renders from received `paramValues` and never pushes defaults itself.

### Read/Write Symmetry
- UI sliders -> dispatch `set_effect_parameters` Action; main updates store, writes to SC, broadcasts.
- MCP tool -> dispatch `set_effect_parameters` Action; same path.
- UI or MCP `get_current_effect` -> read from the same store snapshot; no custom merging.

### Invariants & Rules
- `paramSpecs` are immutable and only updated by SC spec replies.
- `paramValues` live only in main; UI state mirrors what main broadcasts.
- Only main writes to SC. UI never writes defaults on its own.
- All listeners are registered once; use remove/re-add patterns during HMR to avoid duplicates.

### API Surface (concrete IPC/MCP)
- IPC (renderer <-> main):
  - `effects/actions:set_current_effect` -> `{ name }`
  - `effects/actions:set_effect_parameters` -> `{ name?: string, params: Record<string, number> }`
  - `effects/queries:get_current_effect` -> returns active effect snapshot
  - Broadcast: `effects/state` -> `{ activeEffectName, effect }`

- MCP HTTP tools map 1:1 to the same action handlers in main.

### Error Handling & Observability
- Validate parameter names; return separate lists for unknown/invalid/clamped.
- Log each OSC send with address and typed args (behind a debug flag for perf).
- Add a per-effect `lastAppliedToSCAt` timestamp; useful for debugging stale issues.

### Migration Plan
1. Introduce `paramSpecs` + `paramValues` structure in main; keep `params` as alias (read-only) temporarily.
2. Add unified action handlers in main; refactor MCP to call them.
3. Update UI to:
   - Stop pushing defaults on boot; subscribe to `effects-state`.
   - Send only actions for changes.
4. Remove legacy flows (direct SC writes from UI except via action IPC).
5. Enable throttling for rapid slider updates.

### Nice-to-haves (later)
- Persist `paramValues` per effect to disk; restore on boot.
- Add schema validation with zod for actions.
- Add unit tests around action handlers and state transitions.

### Expected Outcomes
- No more double-sends or race between defaults and live values.
- UI and MCP become thin clients; main enforces invariants.
- `get_current_effect` always reflects the latest live state (`paramValues`) with clear specs (`paramSpecs`).



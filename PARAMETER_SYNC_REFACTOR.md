# Parameter Synchronization Refactor Plan

## Overview
This document outlines a plan to fix parameter synchronization issues causing stuttering and conflicts when using MIDI controllers, MCP commands, and UI faders simultaneously.

## Current Problems
1. **Multiple Sources of Truth**: State is scattered across SuperCollider, Electron's effectsStore, and React components
2. **Circular Update Loops**: MIDI → SC → OSC → Electron → IPC → React → IPC → Electron → OSC → SC
3. **Mismatched Throttle Rates**: Different components throttle at different rates (10ms, 16ms, 50ms, 300ms)
4. **Feedback Loops**: Each layer tries to both consume AND produce state changes

## Proposed Architecture

### Core Principles
1. **SuperCollider is the single source of truth** for all parameter values
2. **All parameter changes are one-way** to SuperCollider
3. **UI only displays state**, never maintains it
4. **Fixed broadcast rate** from SC to UI

### Data Flow
```
Parameter Changes (One-Way):
- UI Fader → IPC → Electron → OSC → SuperCollider
- MIDI Controller → OSC → SuperCollider
- MCP → OSC → SuperCollider

State Updates (One-Way):
- SuperCollider → (broadcast every 50ms) → OSC → Electron → IPC → UI
```

## Implementation Plan

### Phase 1: Harmonize Throttle Rates

#### Standard Rate: 50ms for all parameter updates
- 20 updates/second (imperceptible to users)
- Eliminates beat frequencies from mismatched rates
- Reduces CPU/network load

#### Files to Update:

**ParamFader.js**
- Line ~49: Change throttle from 16ms to 50ms
- Line ~56: Change throttle from 16ms to 50ms  
- Line ~150: Change mouse move throttle from 16ms to 50ms

**oscManager.js**
- Line ~19: Change broadcastThrottleMs from 16ms to 50ms

**main.js**
- Line ~409: Change effect state debounce from 10ms to 50ms
- Line ~449: Already 50ms (no change)
- Line ~647: Keep file watcher at 300ms (unrelated)

### Phase 2: Remove Feedback Paths

#### 1. Remove MIDI → UI forwarding
In `oscManager.js`, remove or comment out:
```javascript
case '/effect/param/update':
    // This entire handler should be removed
    // It creates feedback by forwarding MIDI changes to UI
```

#### 2. Remove echo prevention logic
In `ParamFader.js`, remove:
- `skipNextUpdateRef` and all its usage
- `fromMidi` flag handling
- Any logic that tries to detect and ignore "own" updates

#### 3. Simplify parameter update handling
In `main.js`, remove:
- Complex debouncing logic in effects/state handler
- MIDI-specific parameter handling

### Phase 3: Implement SC Broadcasting

#### 1. Add parameter broadcast in SuperCollider
In `init.sc`, add a routine that broadcasts all effect parameters:
```supercollider
// Add after masterAnalyser setup
fork {
    loop {
        0.05.wait; // 50ms = 20Hz
        if (~effect.notNil) {
            ~o.sendMsg('/effect/state', 
                *~effect.getPairs  // Or collect current param values
            );
        };
    };
};
```

#### 2. Update UI to only display broadcast state
In `App.js` and `ParamFader.js`:
- Remove local state management for parameter values
- Only update display when receiving `/effect/state` broadcasts
- Send parameter changes to SC but don't update local state

### Phase 4: Handle UI Responsiveness

#### Option A: Pure Broadcast (Simplest)
- UI sends change to SC
- UI waits for broadcast to update display
- Max 50ms latency (usually imperceptible)

#### Option B: Optimistic Updates (Better UX)
- UI shows immediate visual feedback
- Sends change to SC
- When broadcast arrives, snaps to actual SC value
- Add subtle visual indicator while "pending"

## Testing Checklist

- [ ] **UI Fader Test**: Drag faders - should feel smooth with no stuttering
- [ ] **MIDI Test**: Move MIDI knobs - UI updates without stuttering
- [ ] **MCP Test**: Change params via MCP - updates appear in UI
- [ ] **Simultaneous Test**: Use MIDI + UI + MCP at once - no conflicts
- [ ] **Performance Test**: CPU usage should be lower
- [ ] **Sync Test**: All surfaces show identical values

## Rollback Plan

If issues arise, the changes can be reverted by:
1. Restoring original throttle values
2. Re-enabling `/effect/param/update` handler
3. Restoring echo prevention logic

Keep the original code commented rather than deleted during initial implementation.

## Success Metrics

1. **No stuttering** when using MIDI controllers
2. **Consistent values** across all interfaces
3. **Lower CPU usage** (measure before/after)
4. **Simplified codebase** (fewer lines of sync logic)

## Timeline Estimate

- Phase 1 (Throttle Harmonization): 30 minutes
- Phase 2 (Remove Feedback): 1 hour
- Phase 3 (SC Broadcasting): 2 hours
- Phase 4 (UI Updates): 1-2 hours
- Testing: 1 hour

**Total: 5-6 hours**

## Future Improvements

Once stable, consider:
- Making broadcast rate configurable
- Different rates for different parameter types
- Batch parameter updates in a single OSC message
- Add parameter value interpolation for smoother UI updates

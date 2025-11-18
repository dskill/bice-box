# ROTO-CONTROL Integration Plan for Bice Box

## Executive Summary

This plan outlines how to integrate Melbourne Instruments' ROTO-CONTROL motorized MIDI controller with the Bice Box audiovisual effects processor. The integration will enable bi-directional control: Bice Box effect parameters can control ROTO-CONTROL's motorized faders, and ROTO-CONTROL can send parameter changes back to Bice Box effects.

---

## 1. Understanding ROTO-CONTROL

### Device Capabilities
- **Motorized MIDI Controller**: Physical faders/knobs with motor feedback
- **Bi-directional Communication**: Can receive position updates and send user input
- **SysEx API**: Provides extended control beyond standard MIDI CC
- **Use Cases**:
  - Faders automatically move to reflect current effect parameter values
  - User can manipulate physical controls to adjust Bice Box effects
  - Haptic feedback and visual LED feedback on the controller

### Expected SysEx Features (Typical Implementation)
1. **Parameter Value Updates**: Send parameter positions to motorized faders
2. **Parameter Queries**: Request current fader positions
3. **Configuration**: Set fader ranges, curves (linear/exponential), and behaviors
4. **LED Control**: Update LED indicators to reflect effect state
5. **Preset Management**: Store/recall controller configurations per effect

---

## 2. Current Bice Box MIDI Architecture

### Existing MIDI Support
- **Limited**: Only MIDI CC 117 (push-to-talk) currently implemented
- **Flow**: External MIDI → SuperCollider → OSC → Electron → React
- **No Native MIDI in Electron**: Currently relies on SuperCollider for MIDI input

### OSC Infrastructure (Already in Place)
- OSC Server on UDP port 57121
- Handles effect parameter synchronization
- 50ms broadcast cycle for all effect parameters
- Well-established pattern for external control

---

## 3. Integration Architecture Options

### Option A: SuperCollider MIDI Bridge (RECOMMENDED)

**Architecture:**
```
ROTO-CONTROL (USB MIDI)
        ↓
SuperCollider MIDIIn
        ↓
OSC Messages (/midi/sysex, /midi/cc, /midi/note)
        ↓
Electron oscManager.js
        ↓
effectsStore.setEffectParametersAction()
        ↓
SuperCollider Effect Synth (parameter change)
        ↓
50ms Broadcast (/effect/state)
        ↓
Electron → React UI Update
        ↓
MIDI Out (SysEx to update ROTO-CONTROL faders)
```

**Pros:**
- Leverages existing OSC infrastructure
- No new npm dependencies in Electron
- SuperCollider already has mature MIDI support (MIDIClient, MIDIIn, MIDIOut)
- Consistent with current architecture
- Can handle multiple MIDI devices simultaneously

**Cons:**
- Slight latency from MIDI → OSC → Electron
- Requires SuperCollider MIDI configuration

**Implementation Complexity:** Low-Medium

---

### Option B: Electron Native MIDI

**Architecture:**
```
ROTO-CONTROL (USB MIDI)
        ↓
Node.js MIDI Library (easymidi/node-midi)
        ↓
Electron main.js MIDI Handler
        ↓
effectsStore.setEffectParametersAction()
        ↓
SuperCollider Effect Synth (parameter change)
        ↓
50ms Broadcast (/effect/state)
        ↓
React UI Update + MIDI Out (update ROTO-CONTROL)
```

**Pros:**
- Lower latency
- Direct control in Electron
- No SuperCollider configuration needed

**Cons:**
- Requires new npm package (`easymidi` or `node-midi`)
- Platform-specific compilation (may be complex for Raspberry Pi ARM64)
- Adds dependency to Electron build process
- Diverges from current OSC-based architecture

**Implementation Complexity:** Medium-High

---

### Option C: External MIDI-to-HTTP Bridge

**Architecture:**
```
ROTO-CONTROL (USB MIDI)
        ↓
External MIDI Bridge Service (Python/Node)
        ↓
HTTP POST to http://localhost:31337/mcp
        ↓
MCP Tool: set_effect_parameters
        ↓
effectsStore.setEffectParametersAction()
        ↓
(same as above)
```

**Pros:**
- Completely decoupled
- Can be written in any language
- Uses existing MCP HTTP interface
- No modifications to Bice Box code

**Cons:**
- Highest latency (network overhead)
- Requires separate service to run
- More complex deployment
- Overkill for local MIDI device

**Implementation Complexity:** Medium

---

## 4. RECOMMENDED APPROACH: Option A (SuperCollider Bridge)

### Phase 1: MIDI Input (ROTO-CONTROL → Bice Box)

#### 1.1 SuperCollider MIDI Input Handler

**File:** `~/bice-box-effects/utilities/midi_handler.sc` (new file)

**Responsibilities:**
- Initialize MIDI client and connect to ROTO-CONTROL
- Listen for incoming MIDI CC and SysEx messages
- Parse SysEx messages for fader position updates
- Convert MIDI values to parameter ranges (0.0 - 1.0)
- Send OSC messages to Electron

**Key SuperCollider Code Pattern:**
```supercollider
// Initialize MIDI
MIDIClient.init;
MIDIIn.connectAll;

// Listen for CC messages
MIDIdef.cc(\rotoCC, { |val, num, chan, src|
    // Map CC to effect parameter
    // Send OSC: NetAddr("127.0.0.1", 57121).sendMsg('/midi/roto/cc', num, val/127.0);
}, ccNum: nil, chan: nil);

// Listen for SysEx messages
MIDIdef.sysex(\rotoSysex, { |packet, src|
    // Parse SysEx packet
    // Extract parameter ID and value
    // Send OSC: NetAddr("127.0.0.1", 57121).sendMsg('/midi/roto/sysex', paramId, value);
}, srcID: rotoDeviceID);
```

#### 1.2 Electron OSC Handler

**File:** `/electron/oscManager.js`

**Add new message handlers:**
```javascript
// Around line 212, add new handlers:

case '/midi/roto/cc':
  handleRotoCC(args);
  break;

case '/midi/roto/sysex':
  handleRotoSysex(args);
  break;

// Handler functions:
function handleRotoCC(args) {
  const [ccNumber, value] = args;

  // Map CC numbers to effect parameter names
  // This mapping should be configurable per effect
  const paramMapping = getRotoParameterMapping();
  const paramName = paramMapping[ccNumber];

  if (paramName) {
    const normalizedValue = value; // Already 0.0-1.0 from SC

    // Get current effect from store
    const { activeEffectName } = effectsStore;

    // Call setEffectParametersAction with fromMidi flag
    setEffectParametersAction({
      name: activeEffectName,
      params: { [paramName]: normalizedValue },
      fromMidi: true  // Prevents feedback loop
    });
  }
}

function handleRotoSysex(args) {
  const [paramId, value] = args;
  // Similar to handleRotoCC but for SysEx-specific parameters
  // (e.g., high-resolution faders, multi-byte values)
}
```

#### 1.3 Parameter Mapping Configuration

**File:** `/electron/rotoControlMapping.js` (new file)

**Responsibilities:**
- Store mappings between ROTO-CONTROL controls and effect parameters
- Allow per-effect custom mappings
- Persist mappings to user preferences

**Data Structure:**
```javascript
{
  "filter_highpass": {
    "cc1": "cutoff",      // CC 1 controls cutoff parameter
    "cc2": "resonance",   // CC 2 controls resonance
    "sysex_fader1": "mix" // SysEx fader 1 controls mix
  },
  "delay_stereo": {
    "cc1": "delayTime",
    "cc2": "feedback",
    "cc3": "mix"
  }
  // ... mappings for each effect
}
```

---

### Phase 2: MIDI Output (Bice Box → ROTO-CONTROL)

#### 2.1 Motorized Fader Updates

**Trigger:** When effect parameters change (from UI, MCP, or external sources)

**Flow:**
1. SuperCollider broadcasts parameter state every 50ms via `/effect/state`
2. Electron receives updates in `oscManager.js`
3. Electron maintains "last sent MIDI values" to avoid redundant updates
4. For changed parameters, Electron sends OSC back to SuperCollider
5. SuperCollider formats and sends MIDI SysEx to ROTO-CONTROL

**File:** `/electron/oscManager.js`

**Modify existing `/effect/state` handler (around line 138):**
```javascript
case '/effect/state':
  const effectName = args[0];
  const params = parseEffectStateParams(args.slice(1));

  // Existing code: update effectsStore, broadcast to UI
  // ...

  // NEW: Send MIDI updates to ROTO-CONTROL
  updateRotoControlFaders(effectName, params);
  break;

// New function:
function updateRotoControlFaders(effectName, params) {
  const mapping = getRotoParameterMapping()[effectName];
  if (!mapping) return;

  // For each mapped parameter
  Object.entries(params).forEach(([paramName, value]) => {
    const midiControl = Object.entries(mapping).find(
      ([cc, name]) => name === paramName
    );

    if (midiControl) {
      const [controlType, controlNum] = parseMidiControl(midiControl[0]);

      // Check if value changed since last MIDI send
      if (hasValueChanged(effectName, paramName, value)) {
        // Send OSC to SuperCollider to send MIDI out
        sendOSC('/midi/roto/update', [controlType, controlNum, value]);
        cacheLastSentValue(effectName, paramName, value);
      }
    }
  });
}
```

#### 2.2 SuperCollider MIDI Output

**File:** `~/bice-box-effects/utilities/midi_handler.sc`

**Add OSC receiver and MIDI output:**
```supercollider
// Receive parameter updates from Electron
OSCdef(\rotoUpdate, { |msg|
    var controlType = msg[1]; // 'cc' or 'sysex'
    var controlNum = msg[2];
    var value = msg[3]; // 0.0 - 1.0

    case
    { controlType == 'cc' } {
        // Send standard MIDI CC
        rotoMidiOut.control(0, controlNum, (value * 127).asInteger);
    }
    { controlType == 'sysex' } {
        // Format SysEx message for ROTO-CONTROL
        // Typically: [0xF0, manufacturer_id, device_id, command, param_id, value_msb, value_lsb, 0xF7]
        var sysexMsg = formatRotoSysex(controlNum, value);
        rotoMidiOut.sysex(Int8Array.newFrom(sysexMsg));
    };
}, '/midi/roto/update');

// Helper function to format SysEx (device-specific)
~formatRotoSysex = { |paramId, value|
    var value14bit = (value * 16383).asInteger; // 14-bit resolution
    var valueMSB = (value14bit >> 7) & 0x7F;
    var valueLSB = value14bit & 0x7F;

    [
        0xF0,           // Start SysEx
        0x00, 0x21, 0x7E, // Melbourne Instruments manufacturer ID (HYPOTHETICAL - check actual spec)
        0x01,           // ROTO-CONTROL device ID
        0x01,           // Set Parameter command
        paramId & 0x7F, // Parameter ID
        valueMSB,       // Value MSB
        valueLSB,       // Value LSB
        0xF7            // End SysEx
    ];
};
```

---

### Phase 3: UI/Configuration Interface

#### 3.1 ROTO-CONTROL Settings Panel

**Location:** Add to `/src/EffectManagement.js` (Settings modal)

**Features:**
- **Device Connection Status**: Show if ROTO-CONTROL is connected
- **MIDI Device Selection**: Dropdown to select ROTO-CONTROL from available MIDI devices
- **Parameter Mapping Editor**:
  - For current effect, show list of parameters
  - Allow user to assign each parameter to a ROTO-CONTROL fader/knob
  - Learn mode: Click "Learn", move a fader, assignment is captured
- **Save/Load Mappings**: Per-effect mapping presets
- **Test Mode**: Move Bice Box parameters and watch ROTO-CONTROL faders move

**IPC Channels (new):**
```javascript
// Queries
'midi:get_devices' → returns list of MIDI input/output devices
'midi:get_roto_mapping' → returns current effect's mapping
'midi:set_roto_mapping' → saves mapping for current effect
'midi:roto_connection_status' → returns connected/disconnected

// Actions
'midi:connect_roto' → initiates connection
'midi:disconnect_roto' → closes connection
'midi:learn_parameter' → enters learn mode for next MIDI message
```

#### 3.2 Visual Feedback

**Current Effect UI (`src/App.js`):**
- When parameter changes from MIDI input, briefly highlight the parameter fader
- Show small MIDI icon next to parameters that are mapped to ROTO-CONTROL
- Display ROTO-CONTROL connection status in footer/header

---

## 5. SysEx Message Specifications (To Be Determined)

**CRITICAL:** The actual implementation depends on the ROTO-CONTROL SysEx API v1.3 specification. Once the PDF is reviewed, the following needs to be determined:

### Required Information:
1. **Manufacturer ID**: Melbourne Instruments' MIDI manufacturer ID (3-byte)
2. **Device ID**: ROTO-CONTROL specific device identifier
3. **Message Format**:
   - Parameter set command structure
   - Parameter query command structure
   - Response message format
4. **Parameter Addressing**:
   - How are individual faders/knobs addressed? (by index, by ID, by CC mapping?)
   - Value resolution (7-bit, 14-bit, other?)
5. **Special Commands**:
   - Fader position set
   - LED control
   - Haptic feedback control
   - Configuration/preset management
6. **Handshaking**:
   - Device identification/query
   - Acknowledge messages
   - Error handling

### Typical SysEx Format (Generic Example):
```
F0 <Manufacturer ID> <Device ID> <Command> <Data...> F7

Example - Set Fader 1 to 50%:
F0 00 21 7E 01 01 01 40 00 F7
│  │        │  │  │  │  │  └─ End SysEx
│  │        │  │  │  │  └──── Value LSB (0)
│  │        │  │  │  └─────── Value MSB (64 = 50% of 127)
│  │        │  │  └────────── Fader ID (1)
│  │        │  └───────────── Command (01 = Set Parameter)
│  │        └──────────────── Device ID (01 = ROTO-CONTROL)
│  └───────────────────────── Manufacturer ID (00 21 7E = hypothetical)
└──────────────────────────── Start SysEx
```

**Action Required:** Parse the actual SysEx API PDF to fill in these specifics.

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1)
- **Task 1.1**: Create SuperCollider MIDI handler skeleton (`midi_handler.sc`)
  - Initialize MIDI, enumerate devices
  - Basic MIDI CC input → OSC output
- **Task 1.2**: Add OSC handlers in `oscManager.js`
  - Handle `/midi/roto/cc` messages
  - Basic parameter mapping (hardcoded for testing)
- **Task 1.3**: Test MIDI input flow
  - Use ROTO-CONTROL to change one effect parameter
  - Verify parameter updates in UI

### Phase 2: Bi-directional Control (Week 2)
- **Task 2.1**: Implement parameter mapping system
  - Create `rotoControlMapping.js`
  - Add mapping storage (JSON file in user data)
- **Task 2.2**: Implement MIDI output (Bice Box → ROTO-CONTROL)
  - Parse SysEx API specification
  - Implement SysEx message formatting in SuperCollider
  - Hook into `/effect/state` broadcast
- **Task 2.3**: Test bi-directional flow
  - Change parameter in UI, verify fader moves on ROTO-CONTROL
  - Move fader on ROTO-CONTROL, verify UI updates

### Phase 3: UI Configuration (Week 3)
- **Task 3.1**: Build ROTO-CONTROL settings panel
  - MIDI device selection
  - Connection status display
- **Task 3.2**: Implement parameter mapping UI
  - Drag-and-drop or dropdown assignment
  - MIDI learn mode
- **Task 3.3**: Add visual feedback
  - MIDI activity indicators
  - Parameter mapping icons

### Phase 4: Advanced Features (Week 4)
- **Task 4.1**: Per-effect mapping presets
  - Auto-load mapping when effect changes
  - Save/load mapping files
- **Task 4.2**: ROTO-CONTROL LED control
  - Sync LEDs with effect state
  - Visual feedback for parameter ranges
- **Task 4.3**: Multi-device support
  - Allow multiple MIDI controllers simultaneously
  - Device priority and conflict resolution

### Phase 5: Testing & Optimization (Week 5)
- **Task 5.1**: Latency optimization
  - Measure round-trip latency (UI → MIDI → back to UI)
  - Optimize OSC message batching
- **Task 5.2**: Error handling
  - MIDI device disconnect/reconnect
  - Invalid SysEx message handling
- **Task 5.3**: Documentation
  - User guide for ROTO-CONTROL setup
  - Mapping examples for common effects

---

## 7. File Changes Summary

### New Files:
1. **`~/bice-box-effects/utilities/midi_handler.sc`**
   - SuperCollider MIDI input/output handler
   - OSC bridge for MIDI messages

2. **`/electron/rotoControlMapping.js`**
   - Parameter mapping configuration
   - Mapping load/save logic

3. **`/electron/midiManager.js`** (alternative for Option B)
   - Electron native MIDI handler (if chosen over SuperCollider)

### Modified Files:
1. **`/electron/oscManager.js`**
   - Add handlers for `/midi/roto/cc`, `/midi/roto/sysex`, `/midi/roto/update`
   - Add `updateRotoControlFaders()` function
   - Modify `/effect/state` handler

2. **`/electron/main.js`**
   - Add ROTO-CONTROL mapping to `effectsStore`
   - Add IPC handlers for MIDI configuration
   - Initialize MIDI subsystem on app start

3. **`/src/EffectManagement.js`**
   - Add ROTO-CONTROL settings panel
   - MIDI device connection UI
   - Parameter mapping editor

4. **`/src/App.js`**
   - Add MIDI connection status display
   - Visual indicators for MIDI-mapped parameters

5. **`~/bice-box-effects/utilities/init.sc`**
   - Include `midi_handler.sc` initialization

---

## 8. Configuration Files

### `~/.config/bice-box/roto-mappings.json`
```json
{
  "connected_device": "ROTO-CONTROL",
  "midi_port_in": "ROTO-CONTROL MIDI 1",
  "midi_port_out": "ROTO-CONTROL MIDI 1",
  "mappings": {
    "filter_highpass": {
      "fader1": "cutoff",
      "fader2": "resonance",
      "fader3": "mix"
    },
    "delay_stereo": {
      "fader1": "delayTime",
      "fader2": "feedback",
      "fader3": "mix",
      "fader4": "stereoWidth"
    }
  },
  "global_settings": {
    "update_rate_ms": 50,
    "sysex_enabled": true,
    "motor_feedback": true
  }
}
```

---

## 9. Potential Challenges & Solutions

### Challenge 1: MIDI Latency and Feedback Loops
**Problem:** Parameter changes trigger MIDI output, which triggers MIDI input, creating loops

**Solution:**
- Use `fromMidi: true` flag (already implemented in `setEffectParametersAction`)
- Maintain "last sent value" cache to prevent redundant MIDI messages
- Only send MIDI out when value changes exceed threshold (e.g., 0.01)

### Challenge 2: Parameter Range Mapping
**Problem:** ROTO-CONTROL expects 0-127 (7-bit) or 0-16383 (14-bit), Bice Box uses 0.0-1.0, effects have custom ranges (e.g., 20Hz-20kHz)

**Solution:**
- SuperCollider handles all range conversions
- MIDI → Normalized (0.0-1.0) → SuperCollider parameter spec applies warp/range
- MIDI out: Get normalized value from `/effect/state` → convert to MIDI range

### Challenge 3: Effect Changes (Switching Effects)
**Problem:** When user switches effects, ROTO-CONTROL faders are in wrong positions

**Solution:**
1. When effect changes, immediately send all parameter values to ROTO-CONTROL
2. Motors move to new positions (may be dramatic)
3. Alternative: "Soft takeover" - only apply ROTO-CONTROL input when fader matches current value

### Challenge 4: SuperCollider Restart During Development
**Problem:** Hot-reloading SC effects disconnects MIDI

**Solution:**
- MIDI handler should be in persistent utility file (`init.sc`)
- Detect MIDI disconnect and auto-reconnect
- Show connection status in UI

---

## 10. Testing Strategy

### Unit Tests
1. **MIDI Message Parsing**: Test SysEx message formatting/parsing
2. **Parameter Mapping**: Test lookup functions for CC → parameter name
3. **Range Conversion**: Test value scaling (MIDI ↔ normalized ↔ effect range)

### Integration Tests
1. **MIDI Input Flow**: ROTO-CONTROL CC → OSC → Electron → SC → UI update
2. **MIDI Output Flow**: UI change → Electron → OSC → SC → ROTO-CONTROL SysEx
3. **Bi-directional**: Change in UI updates ROTO-CONTROL, manual override updates UI

### Manual Testing Scenarios
1. **Basic Control**: Move fader, see parameter change in real-time
2. **Motor Feedback**: Change UI slider, watch fader move
3. **Effect Switching**: Change effect, faders move to new positions
4. **Device Disconnect**: Unplug ROTO-CONTROL, verify graceful handling
5. **Multi-source**: Change parameter from UI, ROTO-CONTROL, and MCP simultaneously

---

## 11. Performance Considerations

### CPU Usage
- MIDI messages are low bandwidth (~3 bytes per CC, ~10 bytes per SysEx)
- 50ms update rate = 20 updates/sec max per parameter
- For 8 faders: 160 MIDI messages/sec = negligible CPU impact

### Latency Budget
- Target: <20ms round-trip (UI → ROTO-CONTROL → UI)
- Breakdown:
  - UI → Electron IPC: ~1ms
  - Electron → OSC → SC: ~2ms
  - SC → MIDI out: ~1ms
  - ROTO-CONTROL motor response: ~10ms (mechanical)
  - MIDI in → SC → OSC → Electron: ~3ms
  - Electron → React update: ~2ms
  - **Total: ~19ms** (acceptable for musical control)

### Optimization Opportunities
1. **Batch MIDI Messages**: Send all parameter updates in one OSC bundle
2. **Differential Updates**: Only send changed parameters
3. **Rate Limiting**: User can configure update rate (default 50ms, can reduce to 100ms for slower devices)

---

## 12. Future Enhancements

### 12.1 Preset Management
- Save entire ROTO-CONTROL state (all fader positions) per effect
- Recall presets with ROTO-CONTROL buttons
- Sync presets between Bice Box and ROTO-CONTROL memory

### 12.2 Advanced Mapping
- **One-to-many**: One fader controls multiple parameters (e.g., master mix)
- **Many-to-one**: Combine multiple controls (e.g., X/Y pad controls two params)
- **Conditional mapping**: Different mappings based on effect mode/state

### 12.3 MIDI Learn for Effect Creation
- When creating new effect with AI (generativeEffectManager.js), suggest parameter mappings
- Auto-assign most important parameters to first N faders

### 12.4 Remote ROTO-CONTROL
- Use WebSocket to control ROTO-CONTROL over network
- Enable tablet/phone to display ROTO-CONTROL state remotely

### 12.5 Multi-page Support
- ROTO-CONTROL has limited physical controls
- Implement "pages" or "banks" to access more parameters than physical faders
- Use ROTO-CONTROL buttons to switch pages

---

## 13. Dependencies

### Required npm Packages (for Option B - Native MIDI)
```json
{
  "easymidi": "^3.0.1"  // Alternative: "midi": "^2.0.0"
}
```

### SuperCollider Requirements (for Option A - Recommended)
- **Already included in SuperCollider**: No additional packages needed
- Classes used: `MIDIClient`, `MIDIIn`, `MIDIOut`, `MIDIdef`, `Int8Array`

---

## 14. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| SysEx API not well documented | Medium | High | Contact Melbourne Instruments for clarification, reverse-engineer from Ableton extension |
| MIDI latency too high for real-time | Low | Medium | Use Option B (native MIDI) if OSC adds unacceptable latency |
| Feedback loops cause instability | Medium | High | Robust loop prevention with `fromMidi` flag and value caching |
| ROTO-CONTROL firmware incompatibility | Low | High | Test with actual device early, maintain firmware version compatibility table |
| SuperCollider MIDI driver issues on Raspberry Pi | Medium | Medium | Test on target hardware early, have Option B as fallback |

---

## 15. Success Criteria

### Minimum Viable Integration (MVP)
- ✅ ROTO-CONTROL faders can control at least 4 Bice Box effect parameters
- ✅ Changing parameters in Bice Box UI moves ROTO-CONTROL faders
- ✅ Latency <50ms for bi-directional updates
- ✅ No feedback loops or unstable behavior

### Full Integration
- ✅ All ROTO-CONTROL controls mappable to any effect parameter
- ✅ Per-effect mapping presets auto-load
- ✅ Configuration UI for mapping without editing code
- ✅ MIDI learn mode for easy assignment
- ✅ Graceful handling of device connect/disconnect
- ✅ Works on Raspberry Pi (ARM64 build)

### Stretch Goals
- ✅ LED feedback on ROTO-CONTROL synced to effect state
- ✅ Multi-page parameter banks
- ✅ Integration with AI effect generation (auto-suggest mappings)

---

## 16. Next Steps

### Immediate Actions (Before Coding)
1. **✅ Review SysEx API PDF**: Parse actual message formats and command set
2. **✅ Test ROTO-CONTROL**: Connect device, observe MIDI messages with MIDI monitor
3. **✅ Decide on Option A vs B**: Confirm SuperCollider MIDI works on target Raspberry Pi
4. **✅ Create detailed message specification**: Document exact SysEx bytes for each command

### First Implementation Sprint
1. **Day 1-2**: Set up SuperCollider MIDI handler, basic CC input
2. **Day 3-4**: OSC handlers in Electron, test ROTO-CONTROL → Bice Box flow
3. **Day 5**: Parse SysEx API, implement basic SysEx output
4. **Day 6-7**: Test bi-directional control with one effect

### Questions to Answer
1. What is the exact SysEx format for setting fader positions?
2. Does ROTO-CONTROL support high-resolution (14-bit) MIDI?
3. Can we control LEDs independently of fader positions?
4. Is there a device identification SysEx query?
5. What happens if we send parameters faster than motors can respond?

---

## 17. Appendix: Alternative Use Cases

### Use Case 1: Live Performance
- Map most-used effect parameters to ROTO-CONTROL
- Use motorized feedback to see current settings at a glance
- Quick effect switching with preset recall

### Use Case 2: Studio Recording
- ROTO-CONTROL as tactile interface for automation
- Record parameter movements (via Bice Box MCP logging)
- Reproduce exact performances

### Use Case 3: Installation Art
- ROTO-CONTROL provides physical interface for gallery visitors
- Motor movements add visual interest
- Bice Box generates audiovisuals based on visitor interaction

### Use Case 4: Education
- Students learn effects by manipulating physical controls
- Visual feedback (LEDs + screen) reinforces parameter relationships
- Motorized faders demonstrate effect automation

---

## Conclusion

The ROTO-CONTROL integration is highly feasible and aligns well with Bice Box's existing architecture. The recommended approach (SuperCollider MIDI bridge) requires minimal code changes and leverages existing OSC infrastructure. The key dependency is understanding the exact SysEx API specification, after which implementation is straightforward.

**Estimated Development Time**: 3-4 weeks for full integration with configuration UI
**Recommended Team Size**: 1-2 developers
**Hardware Required**: ROTO-CONTROL unit, Raspberry Pi (for testing ARM build)

**Primary Blocker**: Access to detailed SysEx API specification
**Primary Risk**: MIDI driver compatibility on Raspberry Pi (mitigated by Option B fallback)

Once the SysEx API is fully documented, this integration will provide a professional-grade physical control surface for the Bice Box, significantly enhancing the user experience for live performance and studio use.

# Deep Creativity: Batch Effect Generation Plan

## Decisions Made

- **Output**: `/audio/candidates/` - isolated folder for curation before promotion
- **Context**: Independent - each effect generated fresh, no memory of previous

## Current Infrastructure (No New Code Needed)

1. **Claude Skills** - `@audio-effect`, `@polyphonic-synth`, `@glsl-shader` templates
2. **MCP Tools** - `create_or_update_audio_effect`, `test_supercollider_code`
3. **Auto-reload** - New effects appear without restart

## Implementation

### Step 1: Create candidates directory

```bash
mkdir -p /Users/drew/bice-box-effects/audio/candidates
```

### Step 2: Modify MCP tool to support output path

Update `superColliderManager.js` `compileAndSaveEffect()` to accept optional subfolder:
- Default: `/audio/`
- Candidates: `/audio/candidates/`

Or simpler: just use `effectName` like `candidates/shimmer_reverb` - the tool already handles paths.

### Step 3: Generation via Claude Code CLI

```bash
# Terminal 1: App running
cd /Users/drew/src/bice-box && npm run dev

# Terminal 2: Generate effects (run from bice-box-effects)
cd /Users/drew/bice-box-effects

# Single effect
claude -p "Use @audio-effect to create a shimmer reverb with pitch-shifted feedback.
           Name it 'candidates/shimmer_reverb'. Test via MCP and save."

# Batch (shell loop)
PROMPTS=(
  "lo-fi tape saturation with wow and flutter"
  "shimmer reverb with pitch-shifted feedback"
  "ring modulator with envelope follower"
  "granular freeze effect"
  "aggressive bit crusher with resonant filter"
)
for i in "${!PROMPTS[@]}"; do
  claude -p "Use @audio-effect to create: ${PROMPTS[$i]}.
             Name it 'candidates/gen_$(printf '%03d' $i)_<descriptive_name>'.
             Test via MCP, save only if it compiles."
done
```

### Step 4: Curation Workflow

1. Review effects in `/audio/candidates/`
2. Test in app (they'll appear in effect list)
3. Promote good ones: `mv candidates/shimmer_reverb.sc ./`
4. Delete bad ones: `rm candidates/noise_*.sc`

### Step 5: (Future) Gallery UI

Later: Add a curation UI in the app to:
- Preview candidates with audio/visual
- Upvote/downvote
- One-click promote/delete

## Files to Modify

1. **`/Users/drew/bice-box-effects/audio/candidates/.gitkeep`** - Create directory
2. **`/Users/drew/src/bice-box/electron/superColliderManager.js`** - Ensure `loadEffectsList()` scans subdirectories (or update to support `candidates/` prefix in effectName)

## Validation

MCP tool already validates:
- ✅ SuperCollider syntax (compile test)
- ✅ Atomic file write (temp → compile → rename)
- ✅ Error feedback (returns compilation errors)

Not yet validated (future):
- ❌ Produces audio output (requires NRT render)
- ❌ Audio quality metrics (RMS, frequency content)

## Next Steps

1. Create `/audio/candidates/` directory
2. Test one manual generation via Claude Code
3. Verify effect appears in app
4. Run small batch (5 effects)
5. Iterate on prompt templates

# Farm Prompt Template

--- EXAMPLES ---
# For each example, provide the SC filename (from /Users/drew/bice-box-effects/audio/)
# and the corresponding JSON filename (from /Users/drew/bice-box-effects/effects/).
# The script will load these to provide context to the AI.
# Ensure these are GOOD, representative examples of what you expect the AI to generate.

SC_FILE: bypass.sc
JSON_FILE: bypass.json

SC_FILE: hyperdrive.sc
JSON_FILE: hyperdrive.json

SC_FILE: flames.sc
JSON_FILE: flames.json

SC_FILE: ping_pong_delay.sc
JSON_FILE: ping_pong_delay.json

SC_FILE: crackle_reverb.sc
JSON_FILE: crackle_reverb.json


# Add more examples if needed (2-3 good examples are usually sufficient)

--- PROMPT ---
# Your detailed prompt for the new audio effect goes here.
# Be as descriptive as possible about the sound, behavior, and desired parameters.
# For example:
# "Generate a stereo chorus effect. It should have parameters for rate (0.1 Hz to 10 Hz),
# depth (0 to 1), delay time (5ms to 30ms), and feedback (0 to 0.9)."

Generate a "Spectral Freezing Delay" effect. This effect combines a standard delay with a spectral freeze mechanism.
The user should be able to trigger a freeze of the current input's frequency spectrum.
This frozen spectrum will then sustain and can be mixed with the delayed signal.
Parameters:
- Delay Time (10ms to 2000ms)
- Delay Feedback (0 to 0.95)
- Freeze Trigger (e.g., a momentary button, or an envelope follower threshold on the input)
- Freeze Duration (how long the frozen sound sustains, or until next freeze)
- Freeze Mix (0 to 1, how much of the frozen sound is mixed with the output)
- Wet/Dry Mix (0 to 1)

--- CANONICAL SNAKE_CASE IDENTIFIER ---
# This will be used as the CANONICAL_SNAKE_CASE_IDENTIFIER.
# It dictates the .sc filename, the .json filename, and the SuperCollider SynthDef name.
# It will also be used to construct the 'audio' field in the .json file (e.g., "audio/YOUR_IDENTIFIER.sc").
# Convention: lowercase_with_underscores (e.g., my_cool_flanger)
# Example: my_new_chorus
spectral_freezing_delay
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

Generate a 'Monarch Synth' effect that transforms a guitar signal into a powerful monophonic synthesizer sound.
It should perform pitch detection on the input guitar signal and use the detected pitch to drive a sawtooth oscillator.
The effect should allow for shaping the synthesized sound with various parameters to create a wide range of synth tones, from classic leads to gritty basses.

Parameters:
- Synth Octave (-2 to +2 octaves, Default: 0): Transposes the generated sawtooth wave by octaves relative to the detected pitch.
- Synth Filter Cutoff (20Hz to 20kHz, Default: 5000Hz): Controls the cutoff frequency of a resonant low-pass filter applied to the sawtooth wave(s).
- Synth Filter Resonance (0 to 1, Default: 0.2): Adjusts the resonance (Q factor) of the low-pass filter, creating a more pronounced peak at the cutoff frequency.
- Synth Drive (0 to 1, Default: 0.1): Controls the amount of analog-style saturation or distortion applied to the sawtooth wave for a grittier, more aggressive sound.
- Wet/Dry Mix (0 to 1, Default: 0.5): Blends between the original dry guitar signal and the wet synthesized sound.

--- CANONICAL SNAKE_CASE IDENTIFIER ---
# This will be used as the CANONICAL_SNAKE_CASE_IDENTIFIER.
# It dictates the .sc filename, the .json filename, and the SuperCollider SynthDef name.
# It will also be used to construct the 'audio' field in the .json file (e.g., "audio/YOUR_IDENTIFIER.sc").
# Convention: lowercase_with_underscores (e.g., my_cool_flanger)
# Example: my_new_chorus
monarch_synth
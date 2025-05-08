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


# Add more examples if needed (2-3 good examples are usually sufficient)

--- PROMPT ---
# Your detailed prompt for the new audio effect goes here.
# Be as descriptive as possible about the sound, behavior, and desired parameters.
# For example:
# "Generate a stereo chorus effect. It should have parameters for rate (0.1 Hz to 10 Hz),
# depth (0 to 1), delay time (5ms to 30ms), and feedback (0 to 0.9)."

Generate a gritty distortion effect with a baxandall-style tone control (bass and treble). The distortion should have a 'drive' parameter (1 to 100) and an overall 'level' parameter (0 to 1). The bass and treble parameters should range from -12 to +12 dB, defaulting to 0 dB.

--- OUTPUT FILENAME HINT ---
# Suggest a base filename (without extension) for the new effect.
# This will be used for both the .sc and .json files.
# Convention: lowercase_with_underscores (e.g., my_cool_flanger)
# Example: my_new_chorus
gritty_baxandall_distortion
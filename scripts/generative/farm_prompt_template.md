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

Generate a  phaser effedt which takes 2 parameters as input. an X param and a Y param.  This should be suitable fora  guitar phaser effect.  Hook the X and Y param up in an interesting way - the user will interact with it via touchscreen (so XY pos). 

Get creative, but keep the code somewhat simple on this one.  

Parameters:
NONE

--- CANONICAL SNAKE_CASE IDENTIFIER ---
# This will be used as the CANONICAL_SNAKE_CASE_IDENTIFIER.
# It dictates the .sc filename, the .json filename, and the SuperCollider SynthDef name.
# It will also be used to construct the 'audio' field in the .json file (e.g., "audio/YOUR_IDENTIFIER.sc").
# Convention: lowercase_with_underscores (e.g., my_cool_flanger)
# Example: my_new_chorus
phaser_2d
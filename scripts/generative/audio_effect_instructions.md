# SuperCollider (.sc) File Authoring Guidelines

These guidelines aim to maintain consistency and readability across the SuperCollider effect definitions (`.sc` files) in this project. Everything is now self-contained in the `.sc` file - no separate JSON files are needed.

## 1. File Structure

-   **Shader Comment:** Start each file with a shader comment specifying the visual effect: `// shader: shader_name` (e.g., `// shader: oscilloscope`, `// shader: neon_love`).
-   **Encapsulation:** Wrap the entire script content within parentheses `(...)`.
-   **Variable Declaration:** Declare `defName` as a variable at the top: `var defName = \effect_name;`
-   **SynthDef:** Define the primary audio processing logic within a single `SynthDef(defName, { ... })`.
    -   The `defName` (e.g., `\my_effect_name`) MUST be a `Symbol` using `lowercase_snake_case`.
    -   This `defName` MUST precisely match the base filename (without extension) of the `.sc` file itself (e.g., if the file is `my_cool_delay.sc`, the SynthDef name must be `\my_cool_delay`).
-   **`.add` Call:** Immediately follow the closing brace `}` of the `SynthDef` function with `.add;` to compile and register the definition.
-   **Parameter Registration:** Use `~registerEffectSpecs.value(defName, (...))` to register parameter specifications with ControlSpec objects.
-   **Synth Management:** Include a `fork { ... }` block after parameter registration to handle asynchronous synth creation and management.
-   **Logging:** Use `.postln` sparingly for essential status messages (e.g., "Effect SynthDef 'effect_name' added").

## 2. SynthDef Internals

-   **Parameters (NamedControl Style):**
    -   Use `NamedControl` style instead of traditional arguments: `var param = \param.kr(default_value);`
    -   Include standard parameters: `var out = \out.kr(0);`, `var in_bus = \in_bus.kr(0);`, `var analysis_out_bus = \analysis_out_bus.kr;`
    -   Include a `var mix = \mix.kr(0.5);` parameter for wet/dry control if applicable.
    -   Provide sensible default values for all parameters.
    -   **Custom Control Signals:**
        -   If the effect requires custom control signals or triggers (e.g., a manual freeze trigger, an envelope follower input for control purposes), these **MUST** be implemented as NamedControl parameters.
        -   Provide a clear name (e.g., `freezeTrig`, `envFollowIn`) and a sensible default value (e.g., 0).
        -   The value of these parameters can then be controlled externally via `.set` messages to the Synth.
-   **Variable Declaration (`var`):**
    -   **CRITICAL:** Declare *all* local variables using `var varName1, varName2, ...;` in a single block *immediately* after the parameter declarations. **Do not declare variables anywhere else within the function.** This is a common mistake that causes compilation errors.
-   **Signal Input:** Start the processing chain by getting the input signal: `sig = In.ar(in_bus);`. Store the original dry signal if needed for mixing later (e.g., `dry = sig;`).
-   **Signal Processing:** Arrange UGen code logically, reflecting the intended signal flow.
    -   For complex effects with distinct stages, consider storing intermediate processed signals in local variables for clarity and correct routing before further processing or mixing.
-   **Mix Control:** If a `mix` parameter is present, use `XFade2.ar(drySignal, wetSignal, mix * 2 - 1)` for linear crossfading between the original and processed signals.
-   **Analysis Output:** Prepare a mono signal for analysis: `mono_for_analysis = Mix.ar(finalSignal);` and output it with `Out.ar(analysis_out_bus, mono_for_analysis);`
-   **Signal Output:** End the main processing chain with `Out.ar(out, outputSignal);`. Ensure `outputSignal` is stereo if needed, often `[finalSig, finalSig]` or similar.

## 3. Analysis Integration

Effects now use a simplified analysis system managed by `~masterAnalyser`:

-   **Analysis Output:** Each effect must provide a dedicated mono output for analysis using the `analysis_out_bus` parameter.
-   **No Internal Analysis:** Effects should NOT include internal buffer writing, RMS calculation, or SendReply calls for GUI data. All analysis is handled centrally by `~masterAnalyser`.
-   **Mono Signal Preparation:** Use `mono_for_analysis = Mix.ar(finalSignal);` if your final signal is stereo, or assign directly if already mono.
-   **Standard Environment Variables:**
    -   `~input_bus`: Source bus for audio input.
    -   `~effectGroup`: Target group for the effect synth.
    -   `~effect_output_bus_for_analysis`: Bus index for analysis output.

## 4. Code Style

-   **Indentation:** Use consistent indentation (e.g., 4 spaces).
-   **Naming:** Use clear, descriptive names for variables and arguments (e.g., `delayTime`, `feedbackGain`).
-   **Comments:** Add comments (`//` or `/* */`) to explain complex logic, non-obvious parameter choices, or the purpose of specific code sections.

## 5. Parameter Registration

Instead of separate JSON files, parameters are now registered directly in the SuperCollider file using `~registerEffectSpecs.value()`:

**Parameter Registration Structure:**
```supercollider
~registerEffectSpecs.value(defName, (
    paramName: ControlSpec(min, max, 'warp', step, default, "unit"),
    anotherParam: ControlSpec(0.0, 1.0, 'lin', 0, 0.5, "%"),
    // ... more parameters
));
```

**ControlSpec Arguments:**
-   **min/max:** Minimum and maximum values for the parameter range
-   **warp:** Scaling curve - `'lin'` (linear), `'exp'` (exponential), etc.
-   **step:** Value increment step (usually 0 for continuous parameters)
-   **default:** Default value (must match the NamedControl default in SynthDef)
-   **unit:** Unit string for display (e.g., "Hz", "%", "x", "s")

**Common Parameter Types:**
```supercollider
// Linear 0-1 parameters (mix, level, etc.)
mix: ControlSpec(0.0, 1.0, 'lin', 0, 0.5, "%")

// Exponential frequency parameters
freq: ControlSpec(20, 2000, 'exp', 0, 440, "Hz")

// Gain/amplitude parameters
gain: ControlSpec(0.1, 5.0, 'exp', 0, 1.0, "x")

// Time-based parameters
delay: ControlSpec(0.001, 2.0, 'exp', 0, 0.1, "s")
```

**Standard Parameters:**
-   Standard parameters like `out`, `in_bus`, and `analysis_out_bus` should NOT be included in the parameter registration.
-   If using a `mix` parameter for wet/dry control, it should typically be the last parameter registered.

## 6. Complete File Template

Here's a basic template for a new audio effect:

```supercollider
// shader: oscilloscope
(
    var defName = \my_effect;
    var def = SynthDef(defName, {
        // Parameters (NamedControl style)
        var out = \out.kr(0);
        var in_bus = \in_bus.kr(0);
        var analysis_out_bus = \analysis_out_bus.kr;
        var param1 = \param1.kr(0.5);
        var param2 = \param2.kr(1.0);
        var mix = \mix.kr(0.5);
        
        // Variables (MUST be declared here!)
        var sig, processed, mono_for_analysis;

        // Signal processing
        sig = In.ar(in_bus);
        
        // Your effect processing here...
        processed = sig; // Replace with actual processing
        
        // Mix control
        processed = XFade2.ar(sig, processed, mix * 2 - 1);
        
        // Analysis output
        mono_for_analysis = Mix.ar(processed);
        Out.ar(analysis_out_bus, mono_for_analysis);
        
        // Main output
        Out.ar(out, [processed, processed]);
    });
    def.add;
    "Effect SynthDef 'my_effect' added".postln;

    // Parameter registration
    ~registerEffectSpecs.value(defName, (
        param1: ControlSpec(0.0, 1.0, 'lin', 0, 0.5, "%"),
        param2: ControlSpec(0.1, 10.0, 'exp', 0, 1.0, "x"),
        mix: ControlSpec(0.0, 1.0, 'lin', 0, 0.5, "%")
    ));

    // Synth creation
    fork {
        s.sync;
        if(~effect.notNil, {
            "Freeing existing effect synth".postln;
            ~effect.free;
        });
        ~effect = Synth(defName, [
            \in_bus, ~input_bus,
            \analysis_out_bus, ~effect_output_bus_for_analysis
        ], ~effectGroup);
        ("New % synth created with analysis output bus").format(defName).postln;
    };
)
```

## 7. Advanced Techniques

**Feedback Systems (ping_pong_delay.sc):**
```supercollider
// Cross-channel feedback delay
fbNode = LocalIn.ar(2);
leftDelay = DelayC.ar(sig[0] + fbNode[1], 2, delayTime);
rightDelay = DelayC.ar(sig[1] + fbNode[0], 2, delayTime);
LocalOut.ar([leftDelay, rightDelay] * feedback);
```

**Reverse Reverb with Local Buffers (mbv.sc):**
```supercollider
// Create local buffer for reverse reverb
reverb_buffer = LocalBuf(SampleRate.ir * 0.75);
RecordBuf.ar(processed, reverb_buffer, loop: 1);
reverse_sig = PlayBuf.ar(1, reverb_buffer, rate: -1, loop: 1, 
    startPos: BufFrames.kr(reverb_buffer));
reverse_verb_sig = FreeVerb.ar(reverse_sig, mix: 1, room: 1.25, damp: 0.5);
```

**Pitch Detection + Synthesis (flames.sc):**
```supercollider
// Pitch detection with synthesis overlay
# freq, hasFreq = Pitch.kr(in: sig, ampThreshold: 0.02, median: 2);
synth_sig = Select.ar(hasFreq, [
    PinkNoise.ar(0.3), // No pitch detected
    LFSaw.ar(freq * 0.5) * 0.7 + PinkNoise.ar(0.4) // Pitch detected
]) * RunningSum.rms(Mix.ar(sig), 256) * gain;
```

**Custom OSC Data Sending (ping_pong_delay.sc):**
```supercollider
// In SynthDef: Send custom data to visualizations
SendReply.kr(Impulse.kr(30), '/customData', [param1, param2]);


## 8. Common Mistakes to Avoid

-   **Variable Declaration:** Always declare ALL variables at the start of the SynthDef function with `var varName1, varName2, ...;`. Not doing this causes compilation errors.
-   **Parameter Matching:** Ensure ControlSpec defaults match NamedControl defaults exactly.
-   **Analysis Output:** Don't forget the `analysis_out_bus` parameter and mono output.
-   **Shader Comment:** Include the `// shader: shader_name` comment at the top.
-   **Self-Contained:** Everything must be in the `.sc` file - no separate JSON files.
-   **Feedback Stability:** When using LocalIn/LocalOut, always multiply feedback by a value < 1.0 to prevent runaway feedback.
-   **Buffer Management:** Use LocalBuf for temporary buffers rather than global buffers that need allocation.
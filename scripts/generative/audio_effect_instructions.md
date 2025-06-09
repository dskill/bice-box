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
-   **Parameter & Synth Setup:** Define a `specs` variable to hold all `ControlSpec` objects, then call the global helper function `~setupEffect.value(defName, specs)` to handle both parameter registration and synth creation in one step.
-   **Logging:** Use `.postln` sparingly for essential status messages (e.g., "Effect SynthDef 'effect_name' added").

## 2. SynthDef Internals

-   **Parameters (NamedControl Style):**
    -   Use `NamedControl` style instead of traditional arguments: `var param = \param.kr(default_value);`
    -   Include standard parameters: `var out = \out.kr(0);`, `var in_bus = \in_bus.kr(0);`, `var analysis_out_bus = \analysis_out_bus.kr;`
    -   Include a `var mix = \mix.kr(0.5);` parameter for wet/dry control if applicable.
    -   **CRITICAL: Default values for parameters MUST be set from the `specs` variable.** This makes the `ControlSpec` the single source of truth. Example: `var param1 = \param1.kr(specs[\param1].default);`
    -   **Custom Control Signals:**
        -   If the effect requires custom control signals or triggers (e.g., a manual freeze trigger, an envelope follower input for control purposes), these **MUST** be implemented as NamedControl parameters.
        -   Provide a clear name (e.g., `freezeTrig`, `envFollowIn`) and a sensible default value (e.g., 0).
        -   The value of these parameters can then be controlled externally via `.set` messages to the Synth.
-   **Variable Declaration (`var`):**
    -   **CRITICAL:** Declare *all* local variables using `var varName1, varName2, ...;` in a single block *immediately* after the parameter declarations. **Do not declare variables anywhere else within the function.** This is a common mistake that causes compilation errors.
-   **Signal Path: The Mono-First Standard**
    -   **For Performance, Default to Mono:** Your guitar is a mono source. `init.sc` now provides a reliable dual-mono signal on `~input_bus`. The most performant way to process this is in mono.
        -   **Input:** Read the input as a mono signal using `var sig = In.ar(in_bus);`. This sums the input bus to a single channel.
        -   **Processing:** Perform all your filtering, distortion, and other effects on this single mono signal.
        -   **Output:** At the very end, duplicate your processed mono signal for the stereo output: `Out.ar(out, [processed_sig, processed_sig]);`.
    -   **Exception for "True Stereo" Effects:** Some effects, like a ping-pong delay or a stereo chorus, are inherently stereo. Only in these specific cases should you process the signal in stereo.
        -   **Input:** Read the input as a true stereo signal: `var sig = In.ar(in_bus, 2);`.
        -   **Processing:** Perform your stereo-aware logic.
        -   **Output:** Output the resulting stereo signal directly: `Out.ar(out, processed_stereo_sig);`.
-   **Mix Control:** Use `XFade2.ar(drySignal, wetSignal, mix * 2 - 1)` for linear crossfading. SuperCollider automatically handles channel expansion if one signal is mono and the other is stereo (e.g., crossfading a mono dry signal with a stereo reverb).
-   **Analysis Output:** The analysis bus `analysis_out_bus` **MUST** always receive a mono signal.
    -   If you followed the mono-first pattern, your signal is already mono. No `Mix.ar` is needed: `mono_for_analysis = processed_sig;`.
    -   If you created a true stereo effect, you must mix it down: `mono_for_analysis = Mix.ar(processed_stereo_sig);`.
-   **Signal Output:** The main `out` bus **MUST** always receive a stereo signal.

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

Instead of separate JSON files, parameters are now registered directly in the SuperCollider file using `~registerEffectSpecs.value()`. **Effects are limited to a maximum of 12 parameters** (excluding standard parameters like `out`, `in_bus`, and `analysis_out_bus`).

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
-   **default:** Default value for the parameter. This is the single source of truth.
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

This template demonstrates the standard, high-performance, mono-first signal path using the new simplified setup.

```supercollider
// shader: oscilloscope
(
    var defName = \my_effect;

    // 1. Define all parameter specifications in a 'specs' variable
    var specs = (
        param1: ControlSpec(0.1, 10.0, 'exp', 0, 1.0, "x"),
        mix: ControlSpec(0.0, 1.0, 'lin', 0, 0.5, "%")
    );

    // 2. Define the SynthDef
    var def = SynthDef(defName, {
        // Parameters - get defaults directly from the 'specs' variable
        var out = \out.kr(0);
        var in_bus = \in_bus.kr(0);
        var analysis_out_bus = \analysis_out_bus.kr;
        var param1 = \param1.kr(specs[\param1].default);
        var mix = \mix.kr(specs[\mix].default);

        // Variables (MUST be declared here!)
        var sig, dry, processed, mono_for_analysis;

        // Get Mono Input Signal
        // In.ar(in_bus) sums the dual-mono input from init.sc to a single channel for performance.
        sig = In.ar(in_bus);
        dry = sig;

        // Process in Mono
        // Replace this with your actual mono processing chain...
        processed = (sig * param1).tanh;

        // Mix Control
        processed = XFade2.ar(dry, processed, mix * 2 - 1);

        // Analysis Output (must be mono)
        // The signal is already mono, so no need for Mix.ar.
        mono_for_analysis = processed;
        Out.ar(analysis_out_bus, mono_for_analysis);

        // Final Stereo Output
        // Duplicate the processed mono signal to create a stereo pair.
        Out.ar(out, [processed, processed]);
    });
    def.add;
    "Effect SynthDef 'my_effect' added".postln;

    // 3. Register specs and create the synth with a single helper function
    ~setupEffect.value(defName, specs);
)
```

## 7. Advanced Techniques

**Feedback Systems (ping_pong_delay.sc):**
```
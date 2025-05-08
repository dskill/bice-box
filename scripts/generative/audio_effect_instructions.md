# SuperCollider (.sc) File Authoring Guidelines

These guidelines aim to maintain consistency and readability across the SuperCollider effect definitions (`.sc` files) in this project.

## 1. File Structure

-   **Encapsulation:** Wrap the entire script content within parentheses `(...)`.
-   **SynthDef:** Define the primary audio processing logic within a single `SynthDef(\defName, { ... })`.
    -   Use a concise, descriptive `Symbol` (e.g., `\myEffect`) for the `defName`.
-   **`.add` Call:** Immediately follow the closing brace `}` of the `SynthDef` function with `.add;` to compile and register the definition.
-   **Synth Management:** Include a `fork { ... }` block after the `SynthDef` to handle asynchronous synth creation and management. This block should typically:
    -   Wait for server readiness (`s.sync;`).
    -   Free any existing synth stored in `~effect` (`if(~effect.notNil, { ~effect.free; });`).
    -   Create a new instance of the defined Synth (`~effect = Synth(\defName, [\in_bus, ~input_bus], ~targetGroup);`). Use `~effectGroup` if that's the standard target group.
-   **Logging:** Use `.postln` sparingly for essential status messages (e.g., "MyEffect SynthDef added").

## 2. SynthDef Internals

-   **Arguments (`|...|`):**
    -   Declare all controllable parameters as arguments immediately after the `SynthDef`'s opening brace `{`.
    -   Include standard arguments: `out = 0`, `in_bus = 0`.
    -   Include a `mix = 0.5` argument for wet/dry control if applicable.
    -   Provide sensible default values for all arguments.
-   **Variable Declaration (`var`):**
    -   **CRITICAL:** Declare *all* local variables using `var varName1, varName2, ...;` in a single block *immediately* after the argument declarations. **Do not declare variables anywhere else within the function.**
-   **Signal Input:** Start the processing chain by getting the input signal: `sig = In.ar(in_bus);`. Store the original dry signal if needed for mixing later (e.g., `var dry = sig;`).
-   **Signal Processing:** Arrange UGen code logically, reflecting the intended signal flow.
    -   For complex effects with distinct stages, consider storing intermediate processed signals in local variables (e.g., `var mid_processed = ...;`) for clarity and correct routing before further processing or mixing.
-   **Mix Control:** If a `mix` argument is present, use `XFade2.ar(drySignal, wetSignal, mix * 2 - 1)` for linear crossfading between the original and processed signals.
-   **Feedback:** For internal feedback loops within a single processing block, use `LocalIn.ar` and `LocalOut.ar`.
-   **Buffered Effects:** For effects requiring audio buffering (e.g., delays, reverse effects, loopers, granular synthesis), use `LocalBuf` to allocate a buffer and `RecordBuf`/`PlayBuf` (or similar UGens like `BufRd`, `BufWr`) to write to and read from it.
-   **Signal Output:** End the main processing chain with `Out.ar(out, outputSignal);`. Ensure `outputSignal` is stereo, often `[finalSig, finalSig]` or similar.

## 3. Standard Machinery (for GUI Interaction)

Most effects include a standard block for sending data (waveforms, RMS, FFT) to the GUI. Maintain this structure:

-   **Environment Variables:** Utilize standard environment variables:
    -   `~input_bus`: Source bus for audio input.
    -   `~effectGroup`: Target group for the effect synth.
    -   `~relay_buffer_in`, `~relay_buffer_out`: Buffers for input/output waveform snippets.
    -   `~fft_buffer_out`: Buffer for FFT analysis data (if used).
    -   `~rms_bus_input`, `~rms_bus_output`: Control buses for RMS values.
    -   `~chunkSize`, `~numChunks`: For partitioning buffer writes.
-   **Buffer Writing:**
    -   Generate a `phase` signal using `Phasor.ar(0, 1, 0, ~chunkSize);`.
    -   Create a trigger `trig = HPZ1.ar(phase) < 0;`.
    -   Calculate the buffer partition index `partition = PulseCount.ar(trig) % ~numChunks;`.
    -   Write input and output signals to relay buffers:
        ```supercollider
        BufWr.ar(outputSig, ~relay_buffer_out.bufnum, phase + (~chunkSize * partition));
        ```
-   **RMS Calculation:** Calculate RMS for input and output signals:
    ```supercollider
    rms_output = RunningSum.rms(outputSig, 1024);
    Out.kr(~rms_bus_output, rms_output);
    ```
-   **Data Sending:** Use `SendReply.kr` triggered by a high-rate impulse (`kr_impulse = Impulse.kr(60);`) to send data frequently:
    ```supercollider
    SendReply.kr(kr_impulse, '/buffer_refresh', partition); // Notify GUI which buffer partition is ready
    SendReply.kr(kr_impulse, '/rms');                      // Notify GUI that RMS values are updated
    // SendReply.kr(kr_impulse, '/fft_data');               // If using FFT
    // SendReply.kr(Impulse.kr(10), '/custom_data', [...]); // For less frequent custom data
    ```

## 4. Code Style

-   **Indentation:** Use consistent indentation (e.g., 4 spaces).
-   **Naming:** Use clear, descriptive names for variables and arguments (e.g., `delayTime`, `feedbackGain`).
-   **Comments:** Add comments (`//` or `/* */`) to explain complex logic, non-obvious parameter choices, or the purpose of specific code sections.

## 5. JSON Metadata File (.json)

Alongside each SuperCollider effect (`.sc` file), a corresponding JSON metadata file (`.json`) must be created. This file describes the effect and its parameters for the user interface.

**File Naming:** The JSON filename must exactly match the SuperCollider filename, but with a `.json` extension (e.g., `MyEffect.sc` and `MyEffect.json`).

**Structure:**

```json
{
  "name": "Effect Name",
  "description": "A brief description of what the effect does.",
  "visualizer": "visual/oscilloscope.js", // Default for now
  "params": [
    // Parameters array
  ]
}
```

-   **`name` (string):**
    -   This should be a user-friendly name for the effect.
    -   It MUST precisely match the `defName` symbol used in the `SynthDef(\defName, ...)` of the corresponding `.sc` file (without the leading backslash). For example, if `SynthDef(\myCoolReverb, ...)` is used, the name here should be `"myCoolReverb"`.
-   **`description` (string):**
    -   A short (1-2 sentences) description of the effect's sound or behavior.
-   **`visualizer` (string):**
    -   For all new audio effects generated by this process, this field **MUST** be set to `"visual/oscilloscope.js"`.
-   **`params` (array of objects):**
    -   This array defines the controllable parameters of the effect that will be exposed to the UI.
    -   Each object in the array represents one parameter and corresponds to an argument in the `SynthDef` (excluding standard arguments like `out`, `in_bus`).
    -   The order of parameters in this array should ideally match their declaration order in the `SynthDef` for consistency.

    **Parameter Object Structure:**
    ```json
    {
      "name": "paramName",   // Exact match to SynthDef argument name
      "type": "float",       // Currently, only "float" is effectively supported by the UI
      "min": 0.0,            // Minimum value
      "max": 1.0,            // Maximum value
      "default": 0.5         // Default value (must match SynthDef default)
      // "step": 0.01,       // (Future UI enhancement) Value increment step
      // "unit": "Hz",         // (Future UI enhancement) Unit label
      // "values": ["val1", "val2"] // (Only for type: "enum" - Future UI enhancement)
    }
    ```
    -   **`name` (string):** The exact name of the argument as defined in the `SynthDef` (e.g., `delayTime`, `feedbackGain`, `mix`).
    -   **`type` (string):**
        -   For now, assume `"float"`. The UI (`ParamFader.js`) primarily handles continuous numerical values. Support for `"int"` or `"enum"` would require UI updates.
        // -   `"int"`: For integer parameters.
        // -   `"enum"`: For parameters that accept a fixed set of string values (e.g., waveform shape).
    -   **`min` (number):** The minimum value for the parameter.
    -   **`max` (number):** The maximum value for the parameter.
    -   **`default` (number or string):** The default value for the parameter. This **MUST** match the default value specified in the `SynthDef` arguments.
    // -   **`step` (number, optional):** Suggested increment for UI controls (e.g., sliders). Provide a sensible value (e.g., 0.01 for a 0-1 float, 1 for an integer).
    // -   **`unit` (string, optional):** A label for the unit if applicable (e.g., "Hz", "ms", "s", "%", "dB").
    // -   **`values` (array of strings, only for `type: "enum"`):** If the type is `"enum"`, this array lists the possible string values the parameter can take.

    **Standard Parameters:**
    -   If the `SynthDef` includes a `mix = 0.5` argument (for wet/dry control), its corresponding entry in the `params` array should be:
        ```json
        {
          "name": "mix",
          "type": "float",
          "min": 0.0,
          "max": 1.0,
          "default": 0.5
        }
        ```
    -   Standard arguments like `out` and `in_bus` should **NOT** be included in the `params` array.

**Example `params` entry for a `rate` argument in a `SynthDef` like `rate = 1.0`:**
```json
{
  "name": "rate",
  "type": "float",
  "min": 0.1,
  "max": 20.0,
  "default": 1.0
}
```

**Instruction to AI:** When generating the JSON, carefully analyze the `SynthDef` arguments to create accurate `params` entries. Infer sensible `min`, `max`, and `step` values based on common usage for audio effects if not explicitly defined by the user prompt. The `default` value in the JSON *must* match the default value in the `SynthDef`.
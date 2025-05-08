# SuperCollider (.sc) File Authoring Guidelines

These guidelines aim to maintain consistency and readability across the SuperCollider effect definitions (`.sc` files) in this project.

## 1. File Structure

-   **Encapsulation:** Wrap the entire script content within parentheses `(...)`.
-   **SynthDef:** Define the primary audio processing logic within a single `SynthDef(\defName, { ... })`.
    -   The `defName` (e.g., `\my_effect_name`) MUST be a `Symbol` using `lowercase_snake_case`.
    -   This `defName` MUST precisely match the base filename (without extension) of the `.sc` file itself (e.g., if the file is `my_cool_delay.sc`, the SynthDef name must be `\my_cool_delay`).
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

**File Naming:** The JSON filename must exactly match the SuperCollider filename, but with a `.json` extension (e.g., `my_effect.sc` and `my_effect.json`). 
Prefer `lowercase_snake_case` for actual filenames. This `lowercase_snake_case` base filename is also critical for the `SynthDef` name and the `audio` path within the JSON.

**Structure:**

```json
{
  "name": "User Friendly Effect Name", // e.g., "Gritty Distortion", "Shimmering Reverb"
  "description": "A brief description of what the effect does.",
  "audio": "audio/effect_filename.sc", // Path to the SuperCollider audio file
  "visual": "visual/oscilloscope.js", // Default for now
  "params": [
    // Parameters array
  ]
}
```

-   **`name` (string):**
    -   This should be a user-friendly, "pretty" name for the effect, suitable for display in the UI (e.g., "Green Machine", "Crackle Reverb"). The AI should infer this from the user prompt or by converting the `lowercase_snake_case` filename/SynthDef name to a readable title case format.
    -   This is distinct from the `SynthDef` name and the filename, which must be `lowercase_snake_case`.
-   **`description` (string):**
    -   A short (1-2 sentences) description of the effect's sound or behavior.
-   **`audio` (string):**
    -   The relative path to the SuperCollider audio effect file. This MUST follow the format `audio/FILENAME.sc`, where `FILENAME.sc` is the `lowercase_snake_case` name of the generated SuperCollider file (e.g., if the file is `gritty_baxandall_distortion.sc`, this field is `"audio/gritty_baxandall_distortion.sc"`).
-   **`visual` (string):**
    -   For all new audio effects generated by this process, this field **MUST** be set to `"visual/oscilloscope.js"`.
-   **`params` (array of objects):**
    -   This array defines the controllable parameters of the effect that will be exposed to the UI.
    -   Each object in the array represents one parameter and corresponds to an argument in the `SynthDef` (excluding standard arguments like `out`, `in_bus`).
    -   The order of parameters in this array should ideally match their declaration order in the `SynthDef` for consistency.

    **Parameter Object Structure:**
    ```json
    {
      "name": "paramName",   // Exact match to SynthDef argument name (e.g., "drive", "bass")
      "value": 0.5,          // Initial/default value (must match SynthDef default)
      "range": [0.0, 1.0]    // Array with two numbers: [minimumValue, maximumValue]
      // "type": "float",    // Type is implicitly float/numeric for ParamFader
      // "step": 0.01,       // (Future UI enhancement) Value increment step
      // "unit": "Hz",         // (Future UI enhancement) Unit label
    }
    ```
    -   **`name` (string):** The exact name of the argument as defined in the `SynthDef` (e.g., `delayTime`, `feedbackGain`, `mix`).
    -   **`value` (number):** The initial (default) value for the parameter. This **MUST** match the default value specified in the `SynthDef` arguments.
    -   **`range` (array of two numbers):** An array specifying `[minimumValue, maximumValue]` for the parameter.
    // -   **`type` (string):**
    //     -   For now, assume implicitly numeric/float. The UI (`ParamFader.js`) primarily handles continuous numerical values. 
    // -   **`min` (number):** The minimum value for the parameter. (Replaced by `range`)
    // -   **`max` (number):** The maximum value for the parameter. (Replaced by `range`)
    // -   **`default` (number or string):** The default value for the parameter. This **MUST** match the default value specified in the `SynthDef` arguments. (Replaced by `value`)

    **Standard Parameters:**
    -   If the `SynthDef` includes a `mix = 0.5` argument (for wet/dry control), its corresponding entry in the `params` array should be:
        ```json
        {
          "name": "mix",
          "value": 0.5,
          "range": [0.0, 1.0]
        }
        ```
    -   Standard arguments like `out` and `in_bus` should **NOT** be included in the `params` array.

**Example `params` entry for a `rate` argument in a `SynthDef` like `rate = 1.0` (assuming it ranges from 0.1 to 20 Hz):**
```json
{
  "name": "rate",
  "value": 1.0,
  "range": [0.1, 20.0]
}
```

**Instruction to AI:** 
1.  The SuperCollider `SynthDef` name MUST be the `CANONICAL_SNAKE_CASE_IDENTIFIER` provided in the main prompt section labeled '---CANONICAL_SNAKE_CASE_IDENTIFIER---'.
2.  When generating the JSON: 
    a.  Create a user-friendly, title-cased "name" for the effect (e.g., "Crackle Reverb"). This should be derived from the user's descriptive prompt.
    b.  The `audio` field must be the path `audio/THE_CANONICAL_SNAKE_CASE_IDENTIFIER.sc` (where `THE_CANONICAL_SNAKE_CASE_IDENTIFIER` is the one provided in the main prompt).
    c.  For parameters, use "value" for the default and a "range" array `[min, max]`.
3.  Carefully analyze the `SynthDef` arguments to create accurate `params` entries. Infer sensible `range` values based on common usage for audio effects if not explicitly defined by the user prompt. The `value` in the JSON *must* match the default value in the `SynthDef`.
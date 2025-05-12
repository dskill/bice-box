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
    -   **Custom Control Signals:**
        -   If the effect requires custom control signals or triggers (e.g., a manual freeze trigger, an envelope follower input for control purposes) that are not part of the standard audio signal path (`in_bus`) or the standard GUI machinery buses (`~rms_bus_input`, etc.), these **MUST** be implemented as arguments to the `SynthDef`.
        -   Provide a clear name (e.g., `freezeTrig`, `envFollowIn`) and a sensible default value (e.g., 0).
        -   The value of these arguments can then be controlled externally via `.set` messages to the Synth.
        -   **DO NOT** attempt to read from arbitrary new global bus variables (e.g., `In.kr(~my_custom_control_bus)`) unless that bus is explicitly listed as part of the "Standard Machinery (for GUI Interaction)" buses. The generation context cannot define or allocate new global buses. All new dynamic control inputs must be `SynthDef` arguments.
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
    -   If the `SynthDef` includes a `mix = 0.5` argument (for wet/dry control), it should be last in the list of parameters and its corresponding entry in the `params` array should be:
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

### Sending OSC Messages from p5.js Sketches to SuperCollider

Your p5.js visualizations can interact with SuperCollider audio effects by sending OSC (Open Sound Control) messages. This allows for dynamic control of sound parameters based on visual elements.

**1. Sending Mouse Coordinates from p5.js:**

A common use case is to send normalized mouse X and Y positions to control effect parameters. The p5.js instance (`p`) in your sketch will have a `p.sendOscToSc(address, ...args)` function available.

*   **OSC Address:** Use the address `'/params'` for general-purpose parameter control. This allows different visual sketches to potentially control various effects that listen on this common address.
*   **Arguments:** Send the normalized mouse X and Y coordinates.

**Example p5.js Code:**

```javascript
// In your p5.js sketch's draw() function or other relevant update loops:

function draw() {
  // ... your other drawing code ...

  if (p.sendOscToSc) { // Check if the function is available
    let x_val = p.mouseX / p.width;          // Normalize mouseX to 0.0 - 1.0
    let y_val = 1.0 - (p.mouseY / p.height); // Normalize mouseY (inverted) to 0.0 - 1.0

    // Clamp values to avoid issues at exact 0.0 or 1.0 boundaries if needed
    x_val = Math.min(Math.max(x_val, 0.0001), 0.9999);
    y_val = Math.min(Math.max(y_val, 0.0001), 0.9999);

    p.sendOscToSc('/params', x_val, y_val);
  }
}

// You might also send OSC messages on events like mousePressed:
function mousePressed() {
  if (p.sendOscToSc) {
    let x_val = p.mouseX / p.width;
    let y_val = 1.0 - (p.mouseY / p.height);
     x_val = Math.min(Math.max(x_val, 0.0001), 0.9999);
     y_val = Math.min(Math.max(y_val, 0.0001), 0.9999);
    p.sendOscToSc('/params', x_val, y_val, "click"); // Example: sending an extra "click" argument
  }
}
```
*Note: In p5.js, the Y-coordinate is typically 0 at the top and increases downwards. If your SuperCollider effect expects Y to increase upwards (common in mathematical graphs), you might need to invert it as shown (`1.0 - (p.mouseY / p.height)`).*

**2. Receiving OSC in SuperCollider:**

In your SuperCollider effect's `.sc` file, you'll define an `OSCdef` to listen for messages on the `'/params'` address and use the received values to control `Synth` arguments.

**Example SuperCollider Code (within the `fork { ... }` block):**

```supercollider
// ... inside the fork { } block, after ~effect is created ...

if(~oscListener.notNil) { ~oscListener.free; } // Free previous listener if any
~oscListener = OSCdef.new(
    \paramsListener,    // A unique key for this OSCdef
    { |msg, time, addr, recvPort|
        // msg is an array: msg[0] is the address, msg[1] is the first arg (x_val), msg[2] is second (y_val)
        var x_val = msg[1];
        var y_val = msg[2];
        // Optional: Post received values for debugging
        // ("Received /params: X=" ++ x_val ++ ", Y=" ++ y_val).postln;

        if(~effect.notNil, { // Check if the effect synth exists
            // Assuming your SynthDef has arguments named 'x' and 'y' (or similar)
            // These arguments would then be used internally by the SynthDef
            // to modulate sound parameters (e.g., filter cutoff, delay time).
            ~effect.set(
                \x, x_val, // Or whatever your SynthDef argument is for the first value
                \y, y_val  // Or whatever your SynthDef argument is for the second value
            );
        });
    },
    '/params', // The OSC address to listen to
    nil        // Listen on any client address
    // nil, 57120 // Optionally specify client and port if needed
);

// To ensure the OSCdef is removed when the effect is reloaded or stopped:
// It's good practice to store the OSCdef in an environment variable (like ~oscListener)
// and .free it before defining a new one, or when the effect's Synth is freed.
// For example, when ~effect.free is called, also call ~oscListener.free;
```

**Key Considerations:**

*   **SynthDef Arguments:** Your `SynthDef` must have arguments (e.g., `|x = 0.5, y = 0.5|`) that correspond to the values you intend to control via OSC. The `OSCdef` will use `.set` to update these arguments on the running synth.
*   **Mapping:** Inside the `SynthDef`, you'll map these incoming normalized `x` and `y` values (typically 0.0 to 1.0) to useful parameter ranges for your audio processing UGens (e.g., using `.linlin`, `.linexp`).
*   **Address Consistency:** Using `'/params'` as the default address provides a consistent target for p5.js sketches. If a sketch sends to `'/params'`, any loaded SuperCollider effect that listens on `'/params'` can respond.

**3. Backend Implementation (Context - Already Handled):**

*   The `p.sendOscToSc` function is injected into p5.js sketches by `src/VisualizationCanvas.js`.
*   It uses Electron's IPC to send data to `electron/main.js`.
*   `electron/main.js` forwards the OSC message to SuperCollider via an `oscManager`.

This simplified approach allows for straightforward control of audio effects using mouse input from p5.js visualizations.
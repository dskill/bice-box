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
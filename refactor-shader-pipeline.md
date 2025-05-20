# Refactoring Plan: ShaderToy-Style Rendering Pipeline

This document outlines the plan to integrate ShaderToy-style rendering into the Bice Box application using `ShaderToyLite.js`.

## Core Objectives

1.  Enable the use of Shadertoy shaders (`.glsl` files) as an alternative to p5.js sketches for visuals.
2.  Pass audio analysis data (waveforms, FFT, RMS) from SuperCollider to the shaders as uniforms and textures.
3.  Maintain the existing p5.js rendering pipeline for effects that use it.

## Phase 1: Initial Integration and Setup

### 1. Modify `effect.json` Format
   - Add a new optional field `shader` to the `effect.json` schema. This field will store the relative path to the GLSL shader file (e.g., `"shader": "visual/my_cool_shader.glsl"`).
   - For Phase 1, `shader` can be a simple string path. However, it is envisioned to evolve into an object to accommodate future configurations like custom uniforms, fader mappings, and resolution scaling.
   - The existing `visual` field will continue to be used for p5.js sketches.

   **Example `effect.json` (Phase 1 - Simple Path):**
   ```json
   {
     "name": "ShaderTestEffect",
     "audio": "audio/some_audio.sc",
     "shader": "visual/my_shader.glsl", // New field
     "visual": null, // or "visual/fallback_sketch.js" if a p5 fallback is desired
     "params": [],
     "curated": true
   }
   ```

   **Potential Future `effect.json` Structure for `shader`:**
   ```json
   {
     "name": "AdvancedShaderEffect",
     "audio": "audio/some_audio.sc",
     "shader": {
       "path": "visual/my_advanced_shader.glsl",
       "renderResolutionScale": 0.75,
       "uniforms": [
         {
           "name": "iCustomColor",
           "type": "vec3",
           "value": [1.0, 0.5, 0.2],
           "label": "Effect Color",
           "fader": true,
           "min": [0.0, 0.0, 0.0],
           "max": [1.0, 1.0, 1.0]
         }
       ]
     },
     "visual": null,
     "params": [], // Existing params for SuperCollider
     "curated": true
   }
   ```

### 2. Update Data Loading Logic (`electron/superColliderManager.js`)
   - Modify `loadEffectFromFile` in `superColliderManager.js` to read the new `shader` field.
   - It should be able to handle `shader` being a string (for the path directly) or an object (parsing `path` and other configurations like `uniforms` or `renderResolutionScale` in the future).
   - If `shader` path is present (either directly as a string or as `shader.path`), load the content of the GLSL file. This can be done similarly to how `p5SketchContent` is loaded (e.g., into a new property like `shaderContent` on the effect object).
   - The `synths` array and `currentEffect` object will now potentially hold `shaderContent` and the parsed shader configuration.

### 3. Propagate Shader Data to Renderer (`electron/main.js` -> `src/App.js`)
   - Ensure that the `shader` path (or the full shader configuration object) and its content are sent to the renderer process when effects are loaded or updated (`effects-data` IPC message).
   - `src/App.js` will need to manage state for the current shader configuration (e.g., `currentShaderConfig`) and content (`currentShaderContent`).

### 4. Integrate `ShaderToyLite.js` into `src/VisualizationCanvas.js`
   - **Include `ShaderToyLite.js`:** Add the library to the project. This might involve adding it as a dependency or including the script file directly.
   - **Conditional Rendering Logic:**
     - `VisualizationCanvas.js` will check if `currentShaderConfig` (and its `path` or `currentShaderContent`) is available for the current effect.
     - If a shader is specified, it will initialize and use `ShaderToyLite.js` for rendering, potentially using `renderResolutionScale` from the config.
     - If a p5.js sketch (`currentVisualContent`) is specified, it will use the existing p5.js rendering logic.
     - If neither is specified, it should render a blank or default visual.
   - **WebGL2 Context:**
     - `ShaderToyLite.js` requires a WebGL2 context. Update `src/utils/webGLDetector.js` to explicitly check for WebGL2 support if it doesn't already.
     - `VisualizationCanvas.js` should request a WebGL2 context when using `ShaderToyLite.js`.
     - Implement graceful fallback or error display if WebGL2 is not available.
   - **Instance Management:**
     - Create and manage a `shaderToyInstanceRef` similar to `p5InstanceRef`.
     - Implement proper creation (e.g., `new ShaderToyLite('canvasId', shaderContentString)`) and cleanup (e.g., `toy.destroy()`) of the `ShaderToyLite` instance when the effect changes or the component unmounts.
   - **Basic Shader Test:** Start by rendering a very simple static Shadertoy shader (e.g., one that just displays a color or a simple pattern) to confirm the pipeline is working.
   - **Manage the dependencies between buffers (e.g., Buffer B using Buffer A's output as `iChannel0`):**
     - If the shader uses multiple buffer passes, ensure that the dependencies are correctly managed.

## Phase 2: Passing Audio Data to Shaders

This is the most complex part and involves making SuperCollider's audio analysis data available to the GLSL shaders.

### 1. Numeric Data as Uniforms (RMS, Peak, etc.)
   - **`src/VisualizationCanvas.js`:**
     - When using `ShaderToyLite.js`, collect numeric audio data (e.g., `rmsInputRef.current`, `rmsOutputRef.current`).
     - Use `ShaderToyLite.js`'s API (e.g., `toy.setUniform('iRMSInput', rmsInputRef.current)`) to pass these values to the shader.
   - **Shader Side (GLSL):**
     - Declare corresponding uniforms (e.g., `uniform float iRMSInput;`).

### 2. Waveform and FFT Data as Textures (`iChannelN`)
   - **`src/VisualizationCanvas.js`:**
     - **Texture Creation:** Create `WebGLTexture` objects (1D or 2D as appropriate for the data). `ShaderToyLite.js` expects RGBA Float32 textures for compatibility.
       - Waveform data (`waveform0DataRef`, `waveform1DataRef`) can be packed into a texture. For example, a 1D texture where each pixel's R component holds a sample.
       - FFT data (`fft0DataRef`, `fft1DataRef`) can be similarly packed.
     - **Texture Updates:** On receiving new audio data from IPC:
       - Update the `WebGLTexture` content using `gl.texSubImage2D`. This is more efficient than recreating the texture.
     - **Linking to `ShaderToyLite.js`:**
       - `ShaderToyLite.js` allows specifying textures for `iChannel0` to `iChannel3`.
       - Investigate how to provide these externally created and updated textures to `ShaderToyLite.js`. The API `toy.setBufferA({ ..., iChannel0: 'someTexture' })` or `toy.setImage({ ..., iChannel0: myWebGLTexture })` needs to be used. It's likely you'll set up your textures and then tell `ShaderToyLite.js` to use them for specific `iChannel`s in the main image pass or buffer passes.
   - **Shader Side (GLSL):**
     - Access texture data using `texture(iChannel0, texCoord)` or `texelFetch(iChannel0, ivec2(coord), 0)` for direct texel access.
     - `iChannelResolution[N]` uniforms should be available, representing the dimensions of the input textures.

### 3. Standard Uniforms
   - `ShaderToyLite.js` will handle standard Shadertoy uniforms like `iTime`, `iResolution`, `iFrame`, `iMouse` (if mouse input is eventually supported).
   - Ensure `iResolution` is correctly set to the canvas dimensions.

## Phase 3: UI and Workflow Adjustments

### 1. `src/App.js` and `src/VisualizationMode.js`
   - Update state management in `App.js` to handle `currentShaderConfig` and `currentShaderContent`.
   - Modify `switchPreset`, `handleVisualSelect` (if applicable to shaders), etc., to correctly set up either p5.js or ShaderToy rendering paths.
   - `VisualizationMode.js` will pass the necessary shader-related props to `VisualizationCanvas.js`.

### 2. Effect Selection UI
   - The UI might not need significant changes initially if an effect can only have *either* a p5 sketch or a shader.
   - If an effect could have both (e.g., shader as primary, p5 as fallback), UI might need to indicate which is active.

## Follow-up Work / Future Enhancements

1.  **Multiple Buffer Support:**
    *   Extend `effect.json` to support paths for `bufferA`, `bufferB`, `bufferC`, `bufferD` shader files (e.g., `shaderBufferA: "visual/bufferA.glsl"`).
    *   Update `VisualizationCanvas.js` to use `ShaderToyLite.js`'s API for setting up multiple buffer passes (e.g., `toy.setBufferA({ source: bufferACodeString, iChannel0: ... })`).
    *   Manage the dependencies between buffers (e.g., Buffer B using Buffer A's output as `iChannel0`).

2.  **Rename `effect.json` "visual" to "p5":**
    *   For clarity, rename the `visual` field in `effect.json` to `p5` or `p5SketchPath`.
    *   Update all code references (`superColliderManager.js`, `App.js`, etc.) to use the new field name. This is a breaking change for existing `effect.json` files and would require migration.

3.  **Custom `iChannel` Textures (User-provided images/videos):**
    *   Allow users to specify static image files or potentially short video loops as inputs for `iChannelN`.
    *   This would involve loading these media files and making them available as `WebGLTexture` objects.

4.  **Improved Error Handling and Display:**
    *   Provide more user-friendly display of GLSL compilation errors directly in the UI. `ShaderToyLite.js` may have mechanisms to report these.
    *   Handle WebGL2 context loss or unavailability more gracefully.

5.  **Performance Profiling and Optimization:**
    *   Especially on Raspberry Pi, profile the performance of shaders and the data pipeline.
    *   Optimize texture updates and data transfer if bottlenecks are found.

6.  **Shader Parameterization (Uniforms from `effect.json` `params`):**
    *   Extend the current parameter system (`effect.json` `params` field and `ParamFader` UI) to control custom uniforms in Shadertoy shaders, as defined in the `shader.uniforms` array.
    *   This would involve mapping these params to shader uniforms and updating them dynamically.

7.  **Documentation:**
    *   Document the new `shader` field in `effect.json`, including its simple (string) and advanced (object) forms.
    *   Provide guidelines for creating compatible Shadertoy shaders, including available audio uniforms and `iChannel` conventions.

8.  **Per-Effect Render Resolution Control:**
    *   Allow `effect.json` (via `shader.renderResolutionScale` or similar) to specify a render resolution or scale factor for shaders to manage performance, particularly on constrained devices.
    *   `VisualizationCanvas.js` would need to apply this scaling when setting up the `ShaderToyLite.js` rendering context.

## Open Questions / Areas for Investigation

*   **Exact API for `ShaderToyLite.js` with external textures:** Confirm the precise method for passing dynamically updated `WebGLTexture` objects (containing audio data) to `ShaderToyLite.js` for use as `iChannel` inputs. The `toy.addTexture(texture, 'name')` and then referencing `'name'` in `setBufferX/setImage` (e.g., `iChannel0: 'name'`) seems to be the intended path.
*   **`ShaderToyLite.js` error reporting:** How does it expose shader compilation errors or runtime issues? This needs to be tested during implementation.
*   **Resource management for `ShaderToyLite.js`:** Ensure all WebGL resources (programs, shaders, textures, buffers) created by or for `ShaderToyLite.js` are correctly released when an effect is changed or the application closes (e.g., if it has a `toy.destroy()` method or similar).
*   **Investigate `ShaderToyLite.js`'s capabilities for managing render target sizes independently of display canvas size, and its API for setting a wide range of uniform types.**
    *   **Render Target Sizing:** `ShaderToyLite.js` renders at the resolution of the canvas it is initialized with. To achieve rendering at a resolution different from the main display canvas (e.g., for performance scaling), the application will need to: 
        1. Create the canvas element passed to `ShaderToyLite` at the desired *render resolution*.
        2. After `ShaderToyLite` renders to its canvas, the application will draw the content of this canvas onto the main *display canvas*, scaling it as needed. 
        The library does not appear to have an internal mechanism for offscreen rendering at a different resolution than its initialized canvas.
    *   **Uniform Setting for Custom Uniforms:**
        *   `ShaderToyLite.js` directly supports and manages standard Shadertoy uniforms (e.g., `iTime`, `iResolution`, `iMouse`, `iFrame`, `iChannelN`, `iChannelResolution[N]`, `iDate`, `iSampleRate`) through its existing API for setting buffers, images, and common code.
        *   The README does **not** explicitly document a generic high-level API like `toy.setUniform("customUniformName", value)` for arbitrary user-defined uniforms (e.g., `uniform float myCustomValue;`) that are not part of the standard Shadertoy set.
        *   For custom data required by shaders (such as values from faders defined in `effect.json` -> `shader.uniforms` or other dynamic parameters like RMS): The primary documented method for inputting such data is to encode it into a texture (even a small 1xN texture for several float values) and pass this texture via an available `iChannelN` using `toy.addTexture()` and then referencing it in `toy.setImage()` or `toy.setBufferX()`. The shader would then sample this texture.
        *   Further investigation during implementation will be needed to see if `ShaderToyLite.js` internally exposes its `WebGL2RenderingContext` or can be minimally and safely extended to allow setting custom float/vec uniforms directly using standard WebGL calls (`gl.getUniformLocation()`, `gl.uniformXfv()`). If not, texture-based input for custom uniforms will be the main approach. 
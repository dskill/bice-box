# Refactoring Plan: ShaderToy-Style Rendering Pipeline

This document outlines the plan to integrate ShaderToy-style rendering into the Bice Box application using `ShaderToyLite.js`.

**Status: Phases 1 and 2 largely COMPLETE. Phase 3 (UI/Workflow) partially complete. Shader Hot Reloading implemented.**

## Core Objectives

1.  **COMPLETE** Enable the use of Shadertoy shaders (`.glsl` files) as an alternative to p5.js sketches for visuals.
2.  **COMPLETE** Pass audio analysis data (waveforms, FFT, RMS) from SuperCollider to the shaders as uniforms and textures. (Waveform data as `iChannel0` is implemented; other data like FFT/RMS via textures/uniforms is pending further ShaderToyLite investigation or direct uniform setting if possible).
3.  **COMPLETE** Maintain the existing p5.js rendering pipeline for effects that use it.

## Phase 1: Initial Integration and Setup

### 1. Modify `effect.json` Format - **COMPLETE**
   - Add a new optional field `shader` to the `effect.json` schema. This field will store the relative path to the GLSL shader file (e.g., `"shader": "visual/my_cool_shader.glsl"`).
   - The existing `visual` field will continue to be used for p5.js sketches (future plan to rename to `p5`).
   - **Implementation Summary:**
     - `effect.json` now supports a `shader` string field for the GLSL file path.
     - The more complex object structure for `shader` (with `renderResolutionScale`, `uniforms`) is noted as a future enhancement.

   **Example `effect.json` (Implemented):**
   ```json
   {
     "name": "ShaderTestEffect",
     "audio": "audio/some_audio.sc",
     "shader": "visual/my_shader.glsl",
     "visual": null,
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
     "params": [],
     "curated": true
   }
   ```

### 2. Update Data Loading Logic (`electron/superColliderManager.js`) - **COMPLETE**
   - Modify `loadEffectFromFile` in `superColliderManager.js` to read the new `shader` field.
   - If `shader` path is present, load the content of the GLSL file into `shaderContent` on the effect object.
   - The `synths` array and `currentEffect` object now hold `shaderPath` and `shaderContent`.
   - **Implementation Summary:**
     - `loadEffectFromFile` now reads `effect.shader`, loads the `.glsl` file content, and adds `shaderPath` and `shaderContent` to the effect object. This is propagated by `loadEffectsList`.
     - `reloadFullEffect` (triggered by `.json` file watcher) was also updated to load shader path/content.

### 3. Propagate Shader Data to Renderer (`electron/main.js` -> `src/App.js`) - **COMPLETE**
   - Ensure that `shaderPath` and `shaderContent` are sent to the renderer process.
   - `src/App.js` manages state for `currentShaderPath` and `currentShaderContent`.
   - **Implementation Summary:**
     - IPC pathways (`initial load`, `reload-all-effects`, `pull-effects-repo`) using `loadEffectsList` now propagate `shaderPath` and `shaderContent`.
     - `App.js` added `currentShaderPath` and `currentShaderContent` state. Logic in `reloadEffectList`, `switchPreset`, and the `'effect-updated'` IPC handler was updated to manage this state, prioritizing shader data if present and clearing the other visual type. These are passed to `VisualizationMode`.

### 4. Integrate `ShaderToyLite.js` into `src/VisualizationCanvas.js` - **COMPLETE**
   - **Include `ShaderToyLite.js`:** **COMPLETE** (`public/index.html` adds `<script src="%PUBLIC_URL%/ShaderToyLite.js"></script>`).
   - **Conditional Rendering Logic:** **COMPLETE**
     - `VisualizationCanvas.js` renders using ShaderToyLite if `currentShaderContent` and `window.ShaderToyLite` exist, otherwise falls back to p5.js if `currentVisualContent` exists.
   - **WebGL2 Context:** **COMPLETE**
     - `src/utils/WebGLDetector.js` was refactored to prioritize WebGL2, then WebGL1, returning separate flags. `VisualizationCanvas` checks for WebGL2.
   - **Instance Management:** **COMPLETE**
     - Added `shaderToyInstanceRef` and `cleanupShaderToyInstance()`.
     - Solved p5.js/ShaderToyLite conflict by having `VisualizationCanvas` render a main `div`. For ShaderToy, a `<canvas>` is dynamically created inside this `div` and given an ID. For p5.js, it appends its own canvas to this `div`. p5 sketches updated to use `p.canvas.parentElement.targetWidth/Height`.
   - **Basic Shader Test:** **COMPLETE** (Initial shaders rendered successfully).
   - **Manage the dependencies between buffers:** *PENDING (No multi-buffer shaders implemented yet).*
   - **Implementation Summary & Debugging Journey:**
     - Initial error: "WebGL2 not supported" - addressed by WebGLDetector update.
     - `ShaderToyLite` init error: `TypeError: document.getElementById(...).getContext is not a function` - fixed by changing `VisualizationCanvas` to render a `<canvas>` directly, then refined to dynamically create the canvas for ShaderToyLite.
     - Blank screen for p5.js: Fixed by explicitly setting `canvasRef.current.width` and `height` attributes before p5.js/ShaderToyLite init.
     - p5.js narrow canvas: Addressed by setting `targetWidth/Height` on the `<canvas>` DOM element and having p5 sketches use these. This was further refined when `VisualizationCanvas` reverted to rendering a `div` and p5 sketches used `parentElement.targetWidth/Height`.
     - p5.js not rendering after shader: Resolved by the `div` container strategy mentioned above, ensuring proper canvas re-initialization for each type.

## Phase 2: Passing Audio Data to Shaders

### 1. Numeric Data as Uniforms (RMS, Peak, etc.) - *PARTIALLY ADDRESSED / PENDING*
   - **`src/VisualizationCanvas.js`:**
     - Collecting numeric audio data is already done for p5.js.
     - The method to pass these as generic uniforms to `ShaderToyLite.js` needs to use the texture method or await direct uniform API if found/added (see Open Questions).
   - **Shader Side (GLSL):**
     - Declare corresponding uniforms.
   - **Current Status:** Waveform data is passed via `iChannel0`. Passing other numeric data like RMS/FFT magnitudes directly as non-standard uniforms to `ShaderToyLite.js` was unclear from its docs and not implemented yet. The primary method for custom data in `ShaderToyLite.js` seems to be textures.

### 2. Waveform and FFT Data as Textures (`iChannelN`) - **COMPLETE (for Waveform on `iChannel0`)**
   - **`src/VisualizationCanvas.js`:**
     - **Texture Creation & Updates:** **COMPLETE** for `waveform0Data`.
       - A 512x1 `R32F` WebGL texture (`waveformTextureRef`) is created.
       - A `useEffect` hook, dependent on `waveform0Data` (changed from ref to state to trigger effect), updates this texture using `gl.texSubImage2D`.
     - **Linking to `ShaderToyLite.js`:** **COMPLETE** for `iChannel0`.
       - `ShaderToyLite.js` source was modified to expose `this.gl`.
       - `ShaderToyLite.js` source was modified to allow `addTexture(texture, key)` and its `setShader` method was updated to recognize string keys for `iChannelN` (e.g., `config.iChannel0 = 'texture_key'`), linking them to textures added via `addTexture`.
       - In `VisualizationCanvas.js`:
         - `toy.addTexture(waveformTextureRef.current, 'iChannel0_waveform')` is called.
         - `toy.setImage({ source: currentShaderContent, iChannel0: 'iChannel0_waveform' })` links the shader's `iChannel0` to this texture.
     - `cleanupShaderToyInstance` now deletes `waveformTextureRef.current`.
   - **Shader Side (GLSL):**
     - Shaders can access waveform data via `iChannel0`.
   - **Implementation Summary:** Successfully implemented passing `waveform0Data` to shaders via `iChannel0` by creating, updating, and linking a WebGL texture.

### 3. Standard Uniforms - **COMPLETE (via ShaderToyLite)**
   - `ShaderToyLite.js` handles `iTime`, `iResolution`, `iFrame`, etc.
   - Ensured `iResolution` is correctly set by `ShaderToyLite` based on its canvas dimensions.

## Phase 3: UI and Workflow Adjustments

### 1. `src/App.js` and `src/VisualizationMode.js` - **COMPLETE**
   - State management in `App.js` for `currentShaderPath`, `currentShaderContent` is done.
   - `switchPreset` and IPC handlers in `App.js` correctly manage shader/p5 state.
   - `VisualizationMode.js` passes shader props to `VisualizationCanvas.js` and updated dev mode display.

### 2. Effect Selection UI - *No changes yet, implicitly handled by effect data.*
   - The UI currently relies on the loaded effect data. If an effect has `shaderContent`, it's used.
   - No explicit UI to choose between shader/p5 if an effect hypothetically had both.

## Phase 4: Shader Hot Reloading - **COMPLETE**

### 1. Main Process (`electron/main.js`):
   - `set-current-effect` IPC handler: Updated to set `activeVisualSourcePath` to `effect.shaderPath` if a shader is active.
   - `reloadShaderEffect(glslFilePath)` function: Added. Reads the updated `.glsl` file. If it's the `activeVisualSourcePath` or part of the `currentPresetEffect`, it sends a `shader-effect-updated` IPC message with the new `shaderPath` and `shaderContent`. Also updates `shaderContent` in the main `synths` array.
   - `reloadEffectForChangedFile` (file watcher callback): Added a case for `.glsl` files to call `reloadShaderEffect`.

### 2. Renderer Process (`src/App.js`):
   - `handleShaderEffectUpdated((event, { shaderPath, shaderContent }))` callback: Added to listen for `shader-effect-updated`. If the received `shaderPath` matches `currentShaderPath` state, it updates `setCurrentShaderContent`.
   - Integrated into the main IPC listener `useEffect`.

## Phase 5: IPC Argument Handling Refactor - **COMPLETE**

### 1. `electron/preload.js`:
   - The `on` method in `electron/preload.js` was changed from `(event, ...args) => func(...args)` to `(event, ...args) => func(event, ...args)`. This ensures the `event` object is consistently passed as the first argument to all IPC event handlers in the renderer.

### 2. Renderer Components (`src/App.js`, `src/VisualizationCanvas.js`, `src/hooks/useSuperCollider.js`, `src/WifiSettings.js`, `src/EffectManagement.js`):
   - **Issue:** The `preload.js` change caused many existing IPC handlers to break because they were expecting the data payload as the first argument, but now received the `event` object first. This led to errors like "Objects are not valid as a React child" or incorrect data processing.
   - **Fix:** Systematically updated the signatures of all IPC event handlers (`ipcRenderer.on`, `ipcRenderer.once`) in the affected files to `(event, dataPayload)` or `(event, ...actualArgs)`. This involved careful review of all listeners to ensure they correctly destructured or accessed the actual data from the second argument onwards.

## Phase 6: Console Spam Fix - **COMPLETE**

### 1. `src/VisualizationCanvas.js`:
   - **Issue:** Console was spammed with "Removing all event listeners" / "Setting up all event listeners" messages.
   - **Cause:** The `useEffect` hook responsible for setting up IPC listeners had data update functions (like `updateWaveform0Data`) in its dependency array. These functions were being redefined on each render of `VisualizationCanvas`.
   - **Fix:** Wrapped `updateWaveform0Data`, `updateWaveform1Data`, `updateFFT0Data`, `updateFFT1Data`, `updateAudioAnalysis`, `updateTunerData`, and `updateCustomMessage` in `useCallback` with appropriate dependency arrays (mostly empty or stable setters). This stabilized the references to these functions, preventing the `useEffect` for IPC listeners from re-running unnecessarily.


## Follow-up Work / Future Enhancements

1.  **Multiple Buffer Support:**
    *   Extend `effect.json` to support paths for `bufferA`, `bufferB`, `bufferC`, `bufferD` shader files.
    *   Update `VisualizationCanvas.js` to use `ShaderToyLite.js`'s API for multiple buffer passes.

2.  **Rename `effect.json` "visual" to "p5":**
    *   For clarity, rename the `visual` field to `p5` or `p5SketchPath`.
    *   Update all code references. This is a breaking change.

3.  **Custom `iChannel` Textures (User-provided images/videos):**
    *   Allow specification of media files for `iChannelN`.

4.  **Improved Error Handling and Display:**
    *   User-friendly display of GLSL compilation errors.
    *   Graceful WebGL2 context loss handling.

5.  **Performance Profiling and Optimization:**
    *   Profile shaders and data pipeline, especially on Raspberry Pi.

6.  **Shader Parameterization (Uniforms from `effect.json` `params`):**
    *   Extend `effect.json` `params` and `ParamFader` UI to control custom shader uniforms (see updated Open Question on `ShaderToyLite.js` uniform setting).

7.  **Documentation:**
    *   Update documentation for `effect.json` (`shader` field).
    *   Guidelines for creating compatible shaders, detailing `iChannel0` usage for waveform.

8.  **Per-Effect Render Resolution Control:**
    *   Implement `shader.renderResolutionScale` from `effect.json`.

## Open Questions / Areas for Investigation

*   **Exact API for `ShaderToyLite.js` with external textures:** **ANSWERED/IMPLEMENTED.** `toy.addTexture(texture, 'key')` and referencing `'key'` in `setImage({ iChannel0: 'key' })` works. `ShaderToyLite.js` source was modified to support this string key lookup and to expose `toy.gl`.
*   **`ShaderToyLite.js` error reporting:** How does it expose shader compilation errors or runtime issues? *Still needs focused testing during development of more complex shaders.*
*   **Resource management for `ShaderToyLite.js`:** **PARTIALLY ADDRESSED.** Cleanup includes `toy.pause()`, deleting our custom waveform texture, and relying on WebGL context loss. `ShaderToyLite.js` itself doesn't have an explicit `destroy()` method in its README. Canvas elements are removed from the DOM.
*   **Investigate `ShaderToyLite.js\'s capabilities for managing render target sizes independently of display canvas size, and its API for setting a wide range of uniform types.**
    *   **Render Target Sizing:** **CONFIRMED.** `ShaderToyLite.js` renders at the resolution of the canvas it's initialized with. Independent sizing requires an offscreen canvas managed by our application.
    *   **Uniform Setting for Custom Uniforms:** **CONFIRMED.** The README does not show a generic `toy.setUniform("customName", value)` API. The primary method is encoding data into textures for `iChannelN`. Minimal extension to `ShaderToyLite.js` or direct use of its `gl` context might be needed for other custom uniforms if texture-based input is not suitable for all cases (e.g. simple floats, booleans). This investigation is key for "Shader Parameterization" follow-up. 
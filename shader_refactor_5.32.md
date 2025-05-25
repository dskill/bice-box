# Shader Refactoring Plan (v5.32)

This document outlines a plan to restructure shader file management within the Bice-Box project. The primary goals are to enhance extensibility for new shader parameters (e.g., multiple passes, render resolution, author name), and to enable "mix and match" capabilities between audio and visual effects, allowing shaders to be loaded with p5.js visualizers or other visual systems.

## Proposed New Structure

The new structure will involve three main components for each shader:

1.  **Effect JSON (`effects/effect_name.json`):**
    *   Currently, this file might directly link to a `.glsl` file (e.g., `"shader": "shaders/oscilloscope.glsl"`).
    *   This will be changed to link to a new shader metadata file.
    *   Example: `"shaderMetaPath": "shaders/test_shader_meta.json"`

2.  **Shader Metadata JSON (`shaders/shader_name_meta.json`):**
    *   This new file type will reside in the `bice-box-effects/shaders/` directory.
    *   It will contain:
        *   A reference to the actual GLSL code file (e.g., `"glslFile": "oscilloscope.glsl"` - path relative to the `shaders` directory or the metadata file itself).
        *   Descriptive metadata: shader name, author, description.
        *   Definitions for shader-specific uniforms (parameters): including name, GLSL type, default value, range (min/max), and potentially UI hints (e.g., "slider", "colorpicker").
        *   Future extensibility points: definitions for multiple render passes, target render resolution scaling, input texture bindings, etc.
    *   Example (`shaders/oscilloscope_shader_meta.json`):
        ```json
        {
          "name": "Oscilloscope Display",
          "author": "Bice-Box Team",
          "glslFile": "oscilloscope.glsl",
          "renderResolutionScale": 1.0 // Example: 1.0 for full, 0.5 for half
        }
        ```

3.  **GLSL File (`shaders/shader_name.glsl`):**
    *   This file remains largely the same, containing the raw GLSL shader code (e.g., `oscilloscope.glsl`).
    *   It will be referenced by the `glslFile` field in its corresponding `_meta.json` file.

## Impact and Necessary Code Changes

### 1. Data Loading & Management (`superColliderManager.js`)

*   **`loadEffectFromFile(filePath, getEffectsRepoPath)`:**
    *   Modify to check for `synthData.shaderMetaPath` in the effect's JSON.
    *   If `shaderMetaPath` exists:
        *   Construct the full path to the `_meta.json` file (e.g., using `path.join(getEffectsRepoPath(), synthData.shaderMetaPath)`).
        *   Read and parse the `_meta.json` file.
        *   From the parsed metadata, retrieve the `glslFile` name/path.
        *   Construct the full path to the `.glsl` file (e.g., `path.join(path.dirname(full_meta_json_path), metadata.glslFile)`).
        *   Read the content of the `.glsl` file.
        *   Store both the parsed metadata and the GLSL content within the effect object in the `synths` array. The structure could be:
            ```javascript
            // Inside the effect object within the 'synths' array
            effect.name = synthData.name;
            // ... other properties ...
            effect.shaderMetaPath = synthData.shaderMetaPath; // e.g., 'shaders/oscilloscope_shader_meta.json'
            effect.shader = {
                meta: { /* parsed content of oscilloscope_shader_meta.json */ },
                content: "/* GLSL code from oscilloscope.glsl */"
            };
            // Clear out old direct shaderPath and shaderContent if they exist
            delete effect.shaderPath;
            delete effect.shaderContent;
            ```
    *   If `synthData.shaderMetaPath` does *not* exist (for backward compatibility or non-shader effects), the existing logic for `synthData.shader` (direct GLSL path) and `synthData.visual` (p5.js) should be maintained or gracefully handled.

*   **`loadEffectsList(...)`:**
    *   This function calls `loadEffectFromFile`, so changes there will propagate. Ensure the `synths` array correctly reflects the new shader structure.

### 2. Main Process Logic (`electron/main.js`)

*   **Effect Loading & Hot Reloading:**
    *   `reloadFullEffect(jsonPath)`:
        *   When an `effects/*.json` file changes, this function will adapt to load the shader metadata and its associated GLSL content as described in `loadEffectFromFile`.
        *   It will update the corresponding effect in the `synths` array with the new structure.
    *   `activeVisualSourcePath`:
        *   When an effect with a shader is selected (via `ipcMain.on('set-current-effect', ...)`), `activeVisualSourcePath` should now store the path to the `_meta.json` file (e.g., `shaders/oscilloscope_shader_meta.json`). This helps in identifying the active shader for hot-reloading.
    *   `reloadShaderEffect(changedPath)`:
        *   This function is triggered when a `.glsl` file changes.
        *   It needs to be modified to:
            1.  Determine which `_meta.json` files reference this changed `.glsl` file. (This might involve iterating through all loaded `synths` that have a `shader.meta.glslFile` matching the basename of `changedPath`, and whose `shaderMetaPath` directory matches the directory of `changedPath`).
            2.  For each affected shader metadata, re-read the content of the changed `.glsl` file.
            3.  Update the `shader.content` in the corresponding effect objects in the `synths` array.
            4.  If the `activeVisualSourcePath` points to one of the affected `_meta.json` files, then an IPC message (`shader-effect-updated`) needs to be sent to the renderer with the updated `shader.content` and `shader.meta`.
    *   **New Hot Reload Logic for `_meta.json` files:**
        *   A new or modified part of `setupEffectsWatcher` will need to specifically handle changes to `shaders/*_meta.json` files.
        *   When a `_meta.json` file changes:
            1.  Identify the effect(s) in the `synths` array that use this metadata file (by comparing `effect.shaderMetaPath`).
            2.  Re-read the `_meta.json` file.
            3.  Re-read the associated `.glsl` file referenced by the new `glslFile` property in the metadata (in case the GLSL filename itself changed).
            4.  Update the `effect.shader.meta` and `effect.shader.content` for the affected effect(s) in the `synths` array.
            5.  If the `activeVisualSourcePath` matches the path of the changed `_meta.json` file, send an IPC message (`shader-effect-updated` or a more general `effect-updated` for the specific effect) to the renderer with the complete updated shader object (`meta` and `content`).

*   **IPC Messages:**
    *   `effect-updated` (sent from `reloadFullEffect` or when a preset's JSON changes): This message should now carry the richer shader structure: `effect.shader.meta` and `effect.shader.content` if a shader is part of the effect.
    *   `shader-effect-updated` (sent during hot-reloading of active shaders, either GLSL or its meta file):
        *   This should send an object like:
            ```javascript
            {
              shaderMetaPath: 'shaders/oscilloscope_shader_meta.json', // Path to the meta file
              shader: {
                meta: { /* updated metadata */ },
                content: "/* updated GLSL code */"
              }
            }
            ```
    *   `effects-data` (sent when the whole list reloads): Each effect object in the array will have the new shader structure if applicable.

*   **Discovering Shaders for Mix-and-Match (`getAvailableShaders`):**
    *   Create a new function, similar to `getAvailableVisualizers`, e.g., `getAvailableShaders(effectsRepoPath)`.
    *   This function will:
        1.  Scan the `bice-box-effects/shaders/` directory.
        2.  Look for all `*_meta.json` files.
        3.  For each `_meta.json` file found, parse it.
        4.  Return a list of objects, each representing an available shader. Example item:
            ```javascript
            {
              name: "Oscilloscope Display", // from meta.name
              description: "Visualizes waveform and FFT data.", // from meta.description
              author: "Bice-Box Team", // from meta.author
              metaPath: "shaders/oscilloscope_shader_meta.json", // relative path to the meta file
              // Optionally include the full meta content here if useful for immediate display
              // meta: { ...parsed metadata... }
            }
            ```
    *   Expose this function via an IPC handler (e.g., `ipcMain.handle('get-available-shaders', ...)`).
    *   This list can then be used by the UI to allow users to select a shader independently, perhaps to pair with a p5.js visualizer that's designed to host arbitrary shaders, or for a dedicated shader-only visualizer.

### 3. Client-Side (React Components - e.g., `App.js`, `EffectSelector.js`, new Shader Host component)

*   Components that currently handle shaders (e.g., by receiving `shaderPath` and `shaderContent`) will need to be updated to expect and use the new structure: `currentEffect.shader.meta` and `currentEffect.shader.content`.
*   Parameter controls for shaders will now be driven by the `uniforms` array in `currentEffect.shader.meta`. This allows for dynamic generation of UI elements based on uniform type, range, and default values.
*   A new UI component might be needed to display the list of "available shaders" (from `get-available-shaders`) and allow selection for mix-and-match scenarios.
*   The WebGL/shader rendering logic on the client-side will need to:
    *   Use `shader.content` for the shader source.
    *   Parse `shader.meta.uniforms` to set up and update shader uniforms.

## Benefits of this Restructure

*   **Enhanced Extensibility:** Cleanly separates shader-specific configurations from the main effect preset. New shader features (multi-pass, resolution controls, advanced uniform types) can be added to the metadata schema without overhauling the primary effect structure.
*   **Improved Modularity & Reusability:** `_meta.json` files define self-contained, discoverable shader assets. This makes it much easier to reuse shaders across different effects or to integrate them into various visual contexts (e.g., a p5.js sketch acting as a shader host).
*   **Rich Parameterization:** Shader uniforms are explicitly defined with types, default values, ranges, and potentially UI hints within their metadata. This allows for more robust UI generation and validation of parameters.
*   **Clearer Separation of Concerns:** Distinguishes more clearly between an *effect preset* (the overarching configuration in `effects/*.json`) and a *shader asset* (the combination of `shaders/*_meta.json` and its corresponding `*.glsl` file).
*   **Foundation for Mix-and-Match:** The `getAvailableShaders` mechanism provides the data needed for UIs that allow users to independently select and combine audio components with visual components (including these self-described shaders).

## Migration Steps (Conceptual)

1.  **Update `crackle_reverb.json`:**
    *   Change its `shader` field to `shaderMetaPath`.
    *   Create `bice-box-effects/shaders/test_shader_meta.json` (or a more descriptively named file like `oscilloscope_shader_meta.json`).
    *   Populate this metadata file with details for `oscilloscope.glsl`.
2.  **Implement Core Logic Changes:**
    *   Modify `superColliderManager.js` (`loadEffectFromFile`).
    *   Modify `electron/main.js` (hot reloading, IPC messages, `set-current-effect` logic).
3.  **Implement `getAvailableShaders`:**
    *   Add the function and its IPC handler in `electron/main.js`.
4.  **Update Client-Side:**
    *   Adapt shader handling components to use the new `effect.shader.meta` and `effect.shader.content`.
    *   Update UI for shader parameter controls based on `shader.meta.uniforms`.
5.  **Test Thoroughly:**
    *   Effect loading, preset switching.
    *   Hot reloading of `.glsl` files.
    *   Hot reloading of `_meta.json` files.
    *   Hot reloading of `effects/*.json` files that use shaders.
    *   The new "available shaders" list functionality.
6.  **Refactor other existing effects** that use shaders to the new metadata structure.

This refactoring provides a more robust and flexible foundation for handling shaders within the Bice-Box application. 
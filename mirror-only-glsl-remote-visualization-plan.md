# Plan: Mirror-Only GLSL Remote Visualization Prototype

This document outlines the plan to create a simplified remote visualization feature for the bice-box application. The initial prototype will focus on:

1.  **Mirror-Only Mode**: The remote web client will display the same GLSL shader visualization that is currently active on the host device. Remote users cannot select a different visualizer.
2.  **GLSL Shaders Only**: Only GLSL-based visualizers (single-pass and multi-pass, compatible with ShaderToyLite) will be supported for remote viewing in this phase. p5.js visualizers will not be included in this initial remote implementation.
3.  **Uni-directional Data Flow**: Audio analysis data and shader content will flow from the host (Electron application) to the remote web client. No commands or selections will be sent from the remote client back to the host.

## I. Server-Side (Electron App - `main.js`)

The Electron application's main process (`main.js`) will act as the server.

### 1. HTTP Server Setup
   - Integrate a basic HTTP server (e.g., using Node.js's built-in `http` module).
   - **Serve Client Files**:
     - Create and serve a new HTML file: `remote_client.html`.
     - Create and serve a new JavaScript file: `remote_client.js`.
     - Serve the existing `ShaderToyLite.js` library (assuming it's located in a place accessible by `main.js`, or copy it to a serving location).
   - The server should listen on a configurable port (e.g., 3001).
   - The host's IP address and port should be discoverable by the user (e.g., logged to console or displayed in the host app's UI if a settings page exists).

### 2. WebSocket Server Setup
   - Integrate a WebSocket server (e.g., using the `ws` library).
   - **Client Connections**: Allow multiple remote web clients to connect.
   - **Data Broadcasting**:
     - **Audio Data**: When `main.js` receives audio analysis data (e.g., `combined-data` from the OSC manager, containing waveform, FFT, RMS), it should broadcast this data to all connected WebSocket clients. The data format should be JSON.
       ```json
       // Example audio data message
       {
         "type": "audioData",
         "payload": {
           "combinedData": [/*...array of 2050 floats...*/],
           "rmsInput": 0.X,
           "rmsOutput": 0.Y
         }
       }
       ```
     - **Shader Updates**:
       - When the current active visualizer on the host changes **and it is a shader** (either a single `.glsl` file or a multi-pass configuration identified by its base name):
         - `main.js` will load the shader content.
           - For single-pass: The GLSL code as a string.
           - For multi-pass: The shader configuration object (as created by `loadMultiPassShader`).
         - Send a WebSocket message to all connected clients with the new shader content.
           ```json
           // Example shader update message
           {
             "type": "shaderUpdate",
             "payload": {
               // For single-pass:
               "shaderContent": "/* GLSL code string */",
               // For multi-pass:
               // "shaderContent": { "image": "...", "bufferA": "...", "common": "..." }
               "shaderPath": "shaders/your_shader.glsl" // or "shaders/your_multipass_base"
             }
           }
           ```
       - This implies that `main.js`, upon an effect change (via `ipcMain.on('set-current-effect', ...)` or hot-reload), needs to check if `currentEffect.shaderPath` and `currentEffect.shaderContent` are present and then trigger this WebSocket broadcast.

## II. Client-Side (Remote Web Application)

A new, simple web application will run in the user's browser on a remote device.

### 1. `remote_client.html`
   - Basic HTML structure.
   - A `<canvas>` element for ShaderToyLite.
   - Script tags to include:
     - `ShaderToyLite.js` (served by the host).
     - `remote_client.js` (custom logic, served by the host).

### 2. `remote_client.js`
   - **WebSocket Connection**:
     - Establish a WebSocket connection to the server running in the host Electron application (e.g., `ws://[host-ip]:[port]`).
   - **ShaderToyLite Initialization**:
     - Instantiate `ShaderToyLite` on the `<canvas>` element.
   - **WebSocket Message Handling**:
     - **On `audioData` message**:
       - Parse the `payload`.
       - Prepare the `Uint8Array` for the audio texture (1024x2 RGBA) using `payload.combinedData` (first 1024 for waveform, next 1024 for FFT).
       - Update ShaderToyLite's internal audio texture using `toy.updateAudioTexture(uint8AudioData, 1024, 2)`.
       - Update RMS uniforms if `ShaderToyLite.js` supports them (e.g., `toy.setRMSInput(payload.rmsInput)`).
     - **On `shaderUpdate` message**:
       - Parse the `payload`.
       - Get the `shaderContent` (string or object) and `shaderPath`.
       - Clear/reset the existing ShaderToyLite instance if necessary, or reconfigure it.
       - If `shaderContent` is a string (single-pass):
         `toy.setImage({ source: shaderContent });`
       - If `shaderContent` is an object (multi-pass):
         Configure `toy` with `setCommon`, `setBufferA`, `setImage`, etc., mirroring the logic in `VisualizationCanvas.js` but simplified for direct content.
         ```javascript
         // Example for multi-pass
         const config = shaderContent;
         if (config.common) toy.setCommon(config.common);
         if (config.bufferA) toy.setBufferA({ source: config.bufferA, iChannel0: "A" });
         // ... other buffers
         if (config.image) {
             const imageConfig = { source: config.image };
             if (config.bufferA) imageConfig.iChannel0 = "A";
             // ... other channels
             toy.setImage(imageConfig);
         }
         ```
       - Call `toy.play()` if it was stopped or newly initialized.
   - **Resolution Scaling**:
     - The remote client should respect the `// resolution: X.X` metadata if present in the shader code, similar to `VisualizationCanvas.js`. The `getResolutionScaleFromMetadata` function might need to be available or reimplemented in `remote_client.js`. The canvas dimensions for `ShaderToyLite` should be set accordingly.

## III. Data Flow Summary

1.  **Host (Electron)**:
    *   SuperCollider -> OSC -> `oscManager.js` (`main.js`) -> Audio Data (`combinedData`, RMS).
    *   Effect Selection/Hot-Reload -> `main.js` -> Active Shader Content.
2.  **`main.js` (Server Logic)**:
    *   Broadcasts Audio Data via WebSocket.
    *   Broadcasts Shader Content (on change) via WebSocket.
3.  **Remote Client (Browser)**:
    *   Receives Audio Data via WebSocket -> Updates `ShaderToyLite` audio texture and RMS.
    *   Receives Shader Content via WebSocket -> Loads/Updates shader in `ShaderToyLite`.

## IV. Simplifications & Sacrifices for This Prototype

*   **No p5.js Remote Support**: Only GLSL shaders will be viewable remotely.
*   **No Remote Visualizer Selection**: The remote client mirrors the host.
*   **No Bi-directional Communication**: The remote client cannot send any commands or data back to the host.
*   **Basic Error Handling**: Initial implementation may have minimal error handling for WebSocket disconnects, shader loading errors on the client, etc.
*   **Manual Host IP/Port Entry**: The remote client will likely require the user to manually enter the IP address and port of the host bice-box application.

## V. Future Enhancements (Post-Prototype)

*   Add support for p5.js visualizers.
*   Allow remote clients to select visualizers independently of the host.
*   Implement bi-directional communication for remote interactions.
*   Service discovery (e.g., mDNS/Bonjour) to find the host automatically.
*   More robust error handling and UI for the remote client. 
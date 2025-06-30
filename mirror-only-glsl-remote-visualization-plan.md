# Plan: Mirror-Only GLSL Remote Visualization Prototype

This document outlines the plan to create a simplified remote visualization feature for the bice-box application. The initial prototype will focus on:

1.  **Mirror-Only Mode**: The remote web client will display the same GLSL shader visualization that is currently active on the host device. Remote users cannot select a different visualizer.
2.  **GLSL Shaders Only**: Only GLSL-based visualizers (single-pass and multi-pass, compatible with ShaderToyLite) will be supported for remote viewing in this phase. p5.js visualizers will not be included in this initial remote implementation.
3.  **Uni-directional Data Flow**: Audio analysis data and shader content will flow from the host (Electron application) to the remote web client. No commands or selections will be sent from the remote client back to the host.

## I. Server-Side (Electron App)

The Electron application's main process will act as the server.

### 1. HTTP Server Enhancement (`electron/httpServer.js`)
   - The existing Express server in `electron/httpServer.js` will be enhanced.
   - **Serve Client Files**:
     - Create a new directory: `public/remote`.
     - Inside `public/remote`, create `index.html` and `remote_client.js`.
     - Configure the Express app to serve static files from the `public/remote` directory.
     - Serve the existing `public/ShaderToyLite.js` library.
   - The server listens on a configurable port (e.g., 31337, which is already in use).
   - The host's IP address and port must be displayed in the host app's UI so the user knows where to connect.

### 2. WebSocket Server Setup (`electron/httpServer.js`)
   - Integrate a WebSocket server (using the `ws` library) alongside the existing Express server. It should attach to the same `http.Server` instance.
   - **Client Connections**: Allow multiple remote web clients to connect.
   - **Data Broadcasting**:
     - **Audio Data**: When `main.js` receives audio analysis data (e.g., `combined-data` from OSC), it should broadcast this data to all connected WebSocket clients. The data format should be JSON.
       ```json
       // Example audio data message
       {
         "type": "audioData",
         "payload": {
           "combinedData": [/*...array of 2050 floats...*/]
         }
       }
       ```
     - **Shader Updates**: When the active visualizer changes on the host, if it's a shader, `main.js` must load its content and broadcast it to all clients.
       ```json
       // Example shader update message
       {
         "type": "shaderUpdate",
         "payload": {
           // For single-pass:
           "shaderContent": "/* GLSL code string */",
           // For multi-pass:
           // "shaderContent": { "image": "...", "bufferA": "...", "common": "..." },
           "shaderPath": "shaders/your_shader.glsl" // or "shaders/your_multipass_base"
         }
       }
       ```
   - This logic will be triggered by events in `main.js` that signal a change in the visualizer.

## II. Client-Side (Remote Web Application)

A new, simple web application will run in a browser on a remote device.

### 1. `public/remote/index.html`
   - Basic HTML structure.
   - A `<canvas>` element for ShaderToyLite.
   - An element to display connection status or the host IP.
   - Script tags to include:
     - `/ShaderToyLite.js`
     - `/remote_client.js`

### 2. `public/remote/remote_client.js`
   - **WebSocket Connection**:
     - Establish a WebSocket connection to the server. The URL will be `ws://[host-ip]:[port]`. The user will need to input the host IP.
   - **ShaderToyLite Initialization**:
     - Instantiate `ShaderToyLite` on the `<canvas>` element.
   - **WebSocket Message Handling**:
     - **On `audioData` message**:
       - Parse the `payload`.
       - Prepare the audio texture data from `payload.combinedData`.
       - Update ShaderToyLite's audio texture via `toy.updateAudioTexture(...)`.
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
    *   SuperCollider -> OSC -> `oscManager.js` -> `main.js` -> Audio Data (`combinedData`).
    *   Visualizer Selection/Hot-Reload -> `main.js` -> Active Shader Content.
2.  **`httpServer.js` (Server Logic)**:
    *   Serves `public/remote` and `public/ShaderToyLite.js` as static files.
    *   Broadcasts Audio Data via WebSocket.
    *   Broadcasts Shader Content (on change) via WebSocket.
3.  **Remote Client (Browser)**:
    *   Fetches `index.html`, `remote_client.js`, `ShaderToyLite.js` from the host.
    *   Receives Audio Data via WebSocket -> Updates `ShaderToyLite` audio texture.
    *   Receives Shader Content via WebSocket -> Loads/Updates shader in `ShaderToyLite`.

## IV. Note on HTTP vs. HTTPS

For this feature, we will use standard `http` and `ws` (WebSocket) protocols, not `httpss` or `wss` (secure WebSocket).

*   **Simplicity**: This avoids the complexity of generating and managing self-signed SSL certificates for a local network IP address.
*   **User Experience**: It prevents browser security warnings that would alarm users and require them to manually bypass.
*   **Security Context**: Since the application is intended for use on a trusted local network (e.g., home or studio Wi-Fi), the risk associated with unencrypted local traffic is minimal. The data being transmitted is not sensitive.

## V. Simplifications & Sacrifices for This Prototype

*   **No p5.js Remote Support**: Only GLSL shaders will be viewable remotely.
*   **No Remote Visualizer Selection**: The remote client mirrors the host.
*   **No Bi-directional Communication**: The remote client cannot send any commands or data back to the host.
*   **Basic Error Handling**: Initial implementation may have minimal error handling for WebSocket disconnects, shader loading errors on the client, etc.
*   **Manual Host IP/Port Entry**: The remote client will require the user to manually enter the IP address and port of the host bice-box application.

## VI. Future Enhancements (Post-Prototype)

*   Add support for p5.js visualizers.
*   Allow remote clients to select visualizers independently of the host.
*   Implement bi-directional communication for remote interactions.
*   Service discovery (e.g., mDNS/Bonjour) to find the host automatically.
*   More robust error handling and UI for the remote client. 
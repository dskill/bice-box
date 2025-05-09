# Generative Audio Effect Plan

This plan outlines the steps to integrate the generative audio effect system (currently in `scripts/generative/`) directly into the Electron application. This will allow for a feedback loop where generated SuperCollider code is compiled, and if errors occur, the LLM is re-prompted to fix them.

## Phase 1: Core Generative Logic Integration

1.  **[X] Create `electron/generativeEffectManager.js`:**
    *   Create a new file for managing the generative AI interactions.
    *   This module will house the primary logic for communicating with the Gemini API.

2.  **[X] Relocate and Adapt `farm-audio.js` Logic:**
    *   **(Note: The original scripts in `scripts/generative/` should be kept in place for now and not deleted until the new integrated system is fully functional and tested.)**
    *   **[X] Move `parsePromptTemplate()`:**
        *   Transfer the `parsePromptTemplate` function from `scripts/generative/farm-audio.js` to `electron/generativeEffectManager.js`.
        *   Update paths (e.g., `PROMPT_TEMPLATE_PATH`) to be relative to the Electron app's structure or make them configurable. The `__dirname` in `farm-audio.js` for `PROMPT_TEMPLATE_PATH` will need careful adjustment. It might be better to pass the template path as an argument or configure it globally within the Electron app.
    *   **[X] Move `loadFileContent()`:**
        *   Transfer the `loadFileContent` utility function.
    *   **[X] Move `parseGeminiResponse()`:**
        *   Transfer the `parseGeminiResponse` function.
    *   **[X] Adapt Core AI Interaction Logic:**
        *   The main logic from `farmAudioEffect` (constructing the prompt parts, calling `ai.models.generateContent`, etc.) will form the basis of a new function in `electron/generativeEffectManager.js`, e.g., `generateEffectFromPrompt(userPromptData)`.
        *   `API_KEY` handling: Ensure `GEMINI_API_KEY` is accessible in the Electron main process environment.
        *   Paths like `EFFECTS_REPO_PATH`, `AUDIO_EFFECTS_SUBDIR`, `JSON_EFFECTS_SUBDIR`, `INSTRUCTIONS_PATH`, `SYSTEM_PROMPT_PATH` need to be correctly resolved from the Electron app's context. `getEffectsRepoPath()` from `main.js` can be reused.

3.  **[X] Define Main Orchestration Function in `electron/generativeEffectManager.js`:**
    *   **[X] Create `generateAndValidateEffect(promptDetails)`:**
        *   This function will take an object `promptDetails` (which could include the user's textual prompt, and any pre-filled template sections if we want to bypass reading the template file for some invocations).
        *   It will implement the retry loop (e.g., max 3 attempts).
        *   **Inside the loop:**
            *   Call the internal function (adapted from `farmAudioEffect`) to get SC code and JSON from the LLM.
            *   If the LLM call fails or returns no code, handle this as a retryable error or a hard failure.

## Phase 2: SuperCollider Integration & Validation Loop

1.  **[ ] SuperCollider Code Validation:**
    *   **[ ] Write Temporary `.sc` File:** After receiving SC code from the LLM, write it to a temporary `.sc` file (e.g., in `app.getPath('temp')` or a designated subfolder in the effects repo).
    *   **[ ] Utilize `superColliderManager.loadScFile()`:**
        *   Call `superColliderManager.loadScFile(tempScFilePath, getEffectsRepoPath(), mainWindow)` from `electron/generativeEffectManager.js`.
        *   The `mainWindow` instance will need to be passed to or accessible by `electron/generativeEffectManager.js`.
    *   **[ ] Handle `loadScFile` Promise:**
        *   **Success:**
            *   The SC code is valid.
            *   Proceed to save the temporary `.sc` file to its final destination in `EFFECTS_REPO_PATH/AUDIO_EFFECTS_SUBDIR/` using the `outputFilenameHint`.
            *   Save the generated JSON content to `EFFECTS_REPO_PATH/JSON_EFFECTS_SUBDIR/` using the `outputFilenameHint`.
            *   Break the retry loop.
            *   Consider calling `superColliderManager.loadEffectsList()` to refresh the app's effect list.
            *   Return a success status.
        *   **Failure (Compilation Error):**
            *   The promise from `loadScFile` will reject, and an `sc-compilation-error` IPC message would have been sent. The error object from the promise rejection in the main process is what we need.
            *   Extract the SC error message from the promise rejection.
            *   If retries < max_retries:
                *   Increment retry counter.
                *   Construct a new prompt for the LLM, including:
                    *   The original user request.
                    *   The faulty SuperCollider code.
                    *   The specific SuperCollider error message.
                    *   An instruction to fix the error.
                *   Continue the loop.
            *   If retries >= max_retries:
                *   Log the final failure.
                *   Clean up the temporary `.sc` file.
                *   Return a failure status with the last error.

2.  **[ ] API Key Management:**
    *   **[ ] Ensure `GEMINI_API_KEY` is available:** Verify that `process.env.GEMINI_API_KEY` is correctly loaded and accessible in the Electron main process environment where `electron/generativeEffectManager.js` will run.

## Phase 3: Triggering and UI (Optional for now, focus on backend)

1.  **[ ] IPC Handler for Triggering:**
    *   **[ ] Create an IPC listener in `main.js`:** e.g., `ipcMain.handle('generate-new-effect', async (event, userPromptText) => { ... })`.
    *   This handler will call `generativeEffectManager.generateAndValidateEffect({ userPrompt: userPromptText })`.
    *   It should return the success/failure status and any generated file paths or error messages to the renderer.

2.  **[ ] Basic UI Element (Developer Tool):**
    *   (Lower Priority for initial implementation) Add a simple button/form in the React UI (`App.js` or a developer settings panel) that allows sending a prompt text via the new IPC channel.
    *   Display feedback (success, failure, error messages) from the generation process.

## Phase 4: Refinements and Error Handling

1.  **[ ] Robust Error Handling:**
    *   Ensure all promise rejections and potential errors (file system errors, API errors, unexpected responses) are caught and handled gracefully.
    *   Provide clear logging for debugging.
2.  **[ ] Configuration:**
    *   Make paths (e.g., to templates, output directories) easily configurable if needed, possibly centralizing them or using functions like `getEffectsRepoPath()`.
3.  **[ ] Cleanup:**
    *   Ensure temporary files are deleted after the process, especially on failure.
4.  **[ ] Notifications:**
    *   Consider how to notify the user/developer of the outcome (e.g., Electron notifications, updates in the UI).

## Considerations:

*   **Async Nature:** All operations (API calls, file I/O, SuperCollider interaction) will be asynchronous. Manage promises carefully.
*   **Security:** Since this involves writing files and running code, ensure inputs are handled safely, though the primary risk is malformed SC code, which SC itself should mostly sandbox. The LLM interaction is the main external dependency.
*   **`mainWindow` Access:** The `generativeEffectManager` will need access to the `mainWindow` object if it directly calls `loadScFile` (as `loadScFile` uses it for sending IPC messages). Alternatively, `loadScFile` could be refactored to not directly send IPC messages but return more detailed error objects, and the caller (in `main.js` or `generativeEffectManager.js`) can decide how to notify the renderer. For now, passing `mainWindow` is simpler. 
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const superColliderManager = require('./superColliderManager');

async function parsePromptTemplate(promptTemplatePath) {
    try {
        const templateContent = await fs.readFile(promptTemplatePath, 'utf-8');
        const sections = templateContent.split(/--- (EXAMPLES|PROMPT|CANONICAL SNAKE_CASE IDENTIFIER) ---/);

        const examplesStr = sections.find((s, i) => sections[i-1] === 'EXAMPLES') || '';
        let promptStr = sections.find((s, i) => sections[i-1] === 'PROMPT') || '';
        let filenameHintStr = sections.find((s, i) => sections[i-1] === 'CANONICAL SNAKE_CASE IDENTIFIER') || '';

        // Strip comments from prompt and filename hint sections
        promptStr = promptStr.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
        filenameHintStr = filenameHintStr.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

        const examples = [];
        const exampleLines = examplesStr.trim().split('\n');
        for (let i = 0; i < exampleLines.length; i++) {
            const line = exampleLines[i].trim();
            if (line.startsWith('#') || line === '') continue; // Skip comment lines and empty lines

            if (line.startsWith('SC_FILE:')) {
                const scFile = line.replace('SC_FILE:', '').trim();
                // Look for the next non-comment/non-empty line for JSON_FILE
                let j = i + 1;
                while (j < exampleLines.length && (exampleLines[j].trim().startsWith('#') || exampleLines[j].trim() === '')) {
                    j++;
                }

                if (j < exampleLines.length && exampleLines[j].trim().startsWith('JSON_FILE:')) {
                    const jsonFile = exampleLines[j].trim().replace('JSON_FILE:', '').trim();
                    examples.push({ scFile, jsonFile });
                    i = j; // Move i to the processed JSON_FILE line
                } else {
                    console.warn(`Warning: SC_FILE ${scFile} found without a subsequent JSON_FILE line in template.`);
                }
            }
        }
        
        return {
            examples,
            userPrompt: promptStr.trim(),
            outputFilenameHint: filenameHintStr.trim(),
        };
    } catch (error) {
        console.error(`Error parsing prompt template at ${promptTemplatePath}:`, error);
        throw error;
    }
}

async function loadFileContent(filePath) {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        // Return a placeholder or rethrow, depending on how critical the file is
        return `// Error: Could not load ${path.basename(filePath)}`; 
    }
}

function parseGeminiResponse(responseText) {
    const scCodeBlockRegex = /```supercollider\n([\s\S]*?)\n```/m;
    const jsonCodeBlockRegex = /```json\n([\s\S]*?)\n```/m;

    const scMatch = responseText.match(scCodeBlockRegex);
    const jsonMatch = responseText.match(jsonCodeBlockRegex);

    const scCode = scMatch && scMatch[1] ? scMatch[1].trim() : null;
    const jsonContent = jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : null;

    if (!scCode) {
        console.warn('Could not parse SuperCollider code from Gemini response.');
    }
    if (!jsonContent) {
        console.warn('Could not parse JSON content from Gemini response.');
    }
    return { scCode, jsonContent };
}

/**
 * Generates an audio effect using the Gemini API based on a prompt template.
 * @param {object} config - Configuration object.
 * @param {string} config.apiKey - The API key for Google GenAI.
 * @param {string} config.effectsRepoPath - Absolute path to the bice-box-effects repository.
 * @param {string} config.audioEffectsSubdir - Subdirectory for audio (.sc) files within effectsRepoPath.
 * @param {string} config.jsonEffectsSubdir - Subdirectory for JSON metadata files within effectsRepoPath.
 * @param {string} config.promptTemplatePath - Absolute path to the farm_prompt_template.md file.
 * @param {string} config.instructionsPath - Absolute path to the audio_effect_instructions.md file.
 * @param {string} config.systemPromptPath - Absolute path to the system_prompt.md file.
 * @param {string} config.geminiModel - The Gemini model to use (e.g., 'gemini-1.5-pro-latest').
 * @param {string} config.tempPath - Path to the system's temporary directory.
 * @param {object} config.mainWindow - The Electron BrowserWindow instance.
 * @param {object} [retryContext] - Optional. Context for retrying a failed generation.
 * @param {string} [retryContext.previousScCode] - The SuperCollider code from the previous failed attempt.
 * @param {string} [retryContext.errorMessage] - The error message from the SuperCollider compilation failure.
 * @returns {Promise<object|null>} A promise that resolves to an object { scCode, jsonContent, outputFilenameHint } or null if an error occurs.
 */
async function generateEffectFromPrompt(config, retryContext = null) {
    if (!config.apiKey) {
        console.error('Error: GEMINI_API_KEY (config.apiKey) not provided.');
        throw new Error('API key not provided for Gemini.');
    }
    const ai = new GoogleGenAI({ apiKey: config.apiKey });

    try {
        const { examples, userPrompt, outputFilenameHint } = await parsePromptTemplate(config.promptTemplatePath);

        if (!userPrompt) {
            console.error('Error: No prompt found in the template file for the core request.');
            return null;
        }
        if (!outputFilenameHint) {
            console.error('Error: No output filename hint found in the template file.');
            return null;
        }

        console.log(`User prompt (base): ${userPrompt}`);
        console.log(`Output filename hint: ${outputFilenameHint}`);
        console.log(`Found ${examples.length} example(s) to load.`);

        const instructions = await loadFileContent(config.instructionsPath);
        const systemPromptContent = await loadFileContent(config.systemPromptPath);
        let exampleContents = '';

        for (const ex of examples) {
            const scPath = path.join(config.effectsRepoPath, config.audioEffectsSubdir, ex.scFile);
            const jsonPath = path.join(config.effectsRepoPath, config.jsonEffectsSubdir, ex.jsonFile);
            
            const scExample = await loadFileContent(scPath);
            const jsonExample = await loadFileContent(jsonPath);

            exampleContents += `\n\n--- Example SC (${ex.scFile}) ---\n\`\`\`supercollider\n${scExample}\n\`\`\`\n`;
            exampleContents += `--- Example JSON (${ex.jsonFile}) ---\n\`\`\`json\n${jsonExample}\n\`\`\`\n`;
        }

        const canonicalIdentifierPart = {
            text: `---\nCANONICAL_SNAKE_CASE_IDENTIFIER\n---\nUse the following lowercase_snake_case identifier for the SynthDef name and the filename in the JSON \'audio\' field: ${outputFilenameHint}\n---`
        };

        let retryInstructionsText = '';
        if (retryContext && retryContext.previousScCode && retryContext.errorMessage) {
            console.log('--- Preparing Retry Attempt ---');
            console.log('Previous SC Code (faulty):\n', retryContext.previousScCode);
            console.log('Compilation Error:\n', retryContext.errorMessage);
            retryInstructionsText = `
--- RETRY INSTRUCTIONS ---
The previous attempt to generate SuperCollider code failed. Please analyze the following error and the faulty code, then provide a corrected version of the SuperCollider code and the corresponding JSON metadata.

**Compilation Error:**
\`\`\`
${retryContext.errorMessage}
\`\`\`

**Faulty SuperCollider Code:**
\`\`\`supercollider
${retryContext.previousScCode}
\`\`\`

Ensure your new SuperCollider code addresses this error and adheres to all previously stated guidelines.
The user's original request for the effect is below. The JSON should still match the original request and the corrected SuperCollider code.
--- END RETRY INSTRUCTIONS ---
`;
        }

        const fullPromptParts = [
            { text: systemPromptContent },
            { text: '---\nGUIDELINES\n---\n' + instructions },
            { text: '---\nEXAMPLES\n---\n' + (examples.length > 0 ? exampleContents : '\n(No examples provided in template)') },
            canonicalIdentifierPart,
        ];

        if (retryInstructionsText) {
            fullPromptParts.push({ text: retryInstructionsText });
        }

        // Add user request last, or after retry instructions if they exist
        fullPromptParts.push({ text: '---\nUSER REQUEST\n---\n' + userPrompt });
        fullPromptParts.push({ text: 'Ensure the SuperCollider code is complete and functional according to the guidelines. Ensure the JSON is well-formed and all required fields from the guidelines are present and correctly formatted. The SynthDef name in the SC code must be the basis for the \'name\' field in the JSON.' });

        const fullPromptContents = [
            {
                role: 'user',
                parts: fullPromptParts
            }
        ];
        
        console.log('\n--- Full Prompt to Gemini API (with retry context if applicable) ---');
        // console.log(JSON.stringify(fullPromptContents, null, 2)); // Verbose logging

        console.log('\nSending request to Gemini API...');
        
        const result = await ai.models.generateContent({ model: config.geminiModel, contents: fullPromptContents });
        const responseText = result.text; 

        // Simulate API call for now - COMMENTED OUT
        // console.warn("Simulating Gemini API call. Uncomment actual call in production.");
        // const mockResponseText = `
        // \`\`\`supercollider
        // // Mock SuperCollider Code for ${outputFilenameHint}
        // SynthDef(\\\\${outputFilenameHint}, {
        //     |out=0, amp=0.1|
        //     var sig;
        //     sig = SinOsc.ar(440, 0, amp);
        //     Out.ar(out, [sig, sig]);
        // }).add;
        // \`\`\`
        // 
        // \`\`\`json
        // {
        //     \"name\": \"Mock ${outputFilenameHint}\",
        //     \"description\": \"A mock effect.\",
        //     \"audio\": \"audio/${outputFilenameHint}.sc\",
        //     \"visual\": \"visual/oscilloscope.js\",
        //     \"params\": [
        //         {\"name\": \"amp\", \"value\": 0.1, \"range\": [0.0, 1.0]}\n        //     ]
        // }
        // \`\`\`
        // `;
        // const responseText = mockResponseText; // Using mock response - COMMENTED OUT

        if (!responseText) {
            console.error('Error: Empty response from Gemini API.');
            return null;
        }

        console.log('\nReceived response from Gemini. Parsing...');
        const { scCode, jsonContent } = parseGeminiResponse(responseText);

        return { scCode, jsonContent, outputFilenameHint };

    } catch (error) {
        console.error('\nAn error occurred during the generation process:', error);
        throw error; // Re-throw the error to be caught by the caller
    }
}

const MAX_ATTEMPTS = 3;

/**
 * Orchestrates the generation and validation of an audio effect.
 * @param {object} config - Configuration object.
 * @param {string} config.apiKey - The API key for Google GenAI.
 * @param {string} config.effectsRepoPath - Absolute path to the bice-box-effects repository.
 * @param {string} config.audioEffectsSubdir - Subdirectory for audio (.sc) files within effectsRepoPath.
 * @param {string} config.jsonEffectsSubdir - Subdirectory for JSON metadata files within effectsRepoPath.
 * @param {string} config.promptTemplatePath - Absolute path to the farm_prompt_template.md file.
 * @param {string} config.instructionsPath - Absolute path to the audio_effect_instructions.md file.
 * @param {string} config.systemPromptPath - Absolute path to the system_prompt.md file.
 * @param {string} config.geminiModel - The Gemini model to use.
 * @param {string} config.tempPath - Path to the system's temporary directory.
 * @param {object} config.mainWindow - The Electron BrowserWindow instance.
 * @returns {Promise<object|null>} A promise that resolves to an object containing generation results, success status, paths, compilation status, and attemptsMade.
 */
async function generateAndValidateEffect(config) {
    let retryContext = null;
    let lastGenerationResult = null;
    let lastCompilationError = null;
    let attemptsMade = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        attemptsMade++;
        console.log(`--- Attempt ${attemptsMade} of ${MAX_ATTEMPTS} ---`);
        let tempScFilePath = null;

        try {
            const generationResult = await generateEffectFromPrompt(config, retryContext);
            lastGenerationResult = generationResult; // Store for potential use if all retries fail

            if (!generationResult || !generationResult.scCode || !generationResult.jsonContent) {
                console.error(`Attempt ${attemptsMade}: Generation failed or produced incomplete results.`);
                lastCompilationError = 'Generation failed or incomplete.'; // Treat as a form of error
                if (attempt === MAX_ATTEMPTS - 1) {
                    return { ...generationResult, success: false, error: lastCompilationError, attemptsMade, compilationSuccess: false, compilationError: lastCompilationError };
                }
                retryContext = { // Prepare for next attempt, though generation itself failed
                    previousScCode: generationResult ? generationResult.scCode : 'No SC code generated',
                    errorMessage: lastCompilationError
                };
                continue; // Go to next attempt
            }

            if (generationResult.scCode && generationResult.outputFilenameHint) {
                const tempScFileName = `${generationResult.outputFilenameHint}_attempt${attemptsMade}_${Date.now()}.sc`;
                tempScFilePath = path.join(config.tempPath, tempScFileName);
                
                await fs.writeFile(tempScFilePath, generationResult.scCode);
                console.log(`Attempt ${attemptsMade}: Temporary SC file written to: ${tempScFilePath}`);

                try {
                    console.log(`Attempt ${attemptsMade}: Attempting to compile SC file: ${tempScFilePath}`);
                    await superColliderManager.loadScFile(tempScFilePath, config.effectsRepoPath, config.mainWindow);
                    console.log(`Attempt ${attemptsMade}: SC file compiled successfully.`);

                    const scFileName = `${generationResult.outputFilenameHint}.sc`;
                    const jsonFileName = `${generationResult.outputFilenameHint}.json`;
                    const finalScPath = path.join(config.effectsRepoPath, config.audioEffectsSubdir, scFileName);
                    const finalJsonPath = path.join(config.effectsRepoPath, config.jsonEffectsSubdir, jsonFileName);

                    await fs.writeFile(finalScPath, generationResult.scCode);
                    console.log(`Attempt ${attemptsMade}: Successfully saved SuperCollider effect to: ${finalScPath}`);
                    await fs.writeFile(finalJsonPath, generationResult.jsonContent);
                    console.log(`Attempt ${attemptsMade}: Successfully saved JSON metadata to: ${finalJsonPath}`);
                    
                    if (tempScFilePath) {
                        try { await fs.unlink(tempScFilePath); console.log(`Attempt ${attemptsMade}: Temporary SC file deleted: ${tempScFilePath}`); } 
                        catch (e) { console.warn(`Attempt ${attemptsMade}: Failed to delete temp file ${tempScFilePath}`, e.message); }
                    }
                    return { ...generationResult, success: true, finalScPath, finalJsonPath, compilationSuccess: true, compilationError: null, attemptsMade };
                
                } catch (scError) {
                    console.error(`Attempt ${attemptsMade}: SC file compilation failed:`, scError.message || scError);
                    lastCompilationError = scError.message || (typeof scError === 'string' ? scError : 'Unknown SuperCollider compilation error');
                    retryContext = {
                        previousScCode: generationResult.scCode,
                        errorMessage: lastCompilationError
                    };
                }
            } else {
                console.warn(`Attempt ${attemptsMade}: No SC code or output filename hint available. Skipping compilation.`);
                lastCompilationError = 'No SC code generated for compilation.';
            }

        } catch (generationProcessError) {
            console.error(`Attempt ${attemptsMade}: Error during generation process:`, generationProcessError);
            lastCompilationError = generationProcessError.message || 'Error in generation process.';
            // If generateEffectFromPrompt itself throws, retryContext might not be formed with previousScCode
            // We can try to use lastGenerationResult if available, or just the error for the next retry prompt
            retryContext = {
                previousScCode: lastGenerationResult ? lastGenerationResult.scCode : 'Error before SC code generation.',
                errorMessage: lastCompilationError
            };
            if (attempt === MAX_ATTEMPTS - 1) { // Check if it's the last attempt
                 return { 
                    success: false, 
                    error: 'Overall generation process failed after multiple attempts.', 
                    scCode: lastGenerationResult ? lastGenerationResult.scCode : null, 
                    jsonContent: lastGenerationResult ? lastGenerationResult.jsonContent : null, 
                    outputFilenameHint: lastGenerationResult ? lastGenerationResult.outputFilenameHint : null, 
                    compilationSuccess: false, 
                    compilationError: lastCompilationError, 
                    attemptsMade 
                };
            }
        } finally {
            // Clean up the temp file for the current attempt if it exists and wasn't already deleted on success
            if (tempScFilePath) {
                try { await fs.unlink(tempScFilePath); console.log(`Attempt ${attemptsMade}: Cleaned up temp file from finally block: ${tempScFilePath}`); }
                catch (e) { /* Already logged or handled, or success path deleted it */ }
            }
        }
    } // End of for loop

    // If loop finishes, all attempts failed
    console.log('All attempts failed.');
    return { 
        ...(lastGenerationResult || {}), // Return details from the last attempt if available
        success: false, 
        error: 'All generation and compilation attempts failed.', 
        compilationSuccess: false, 
        compilationError: lastCompilationError, 
        attemptsMade 
    };
}

module.exports = {
    parsePromptTemplate,
    loadFileContent,
    parseGeminiResponse,
    generateEffectFromPrompt,
    generateAndValidateEffect,
}; 
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
 * @returns {Promise<object|null>} A promise that resolves to an object { scCode, jsonContent, outputFilenameHint } or null if an error occurs.
 */
async function generateEffectFromPrompt(config) {
    if (!config.apiKey) {
        console.error('Error: GEMINI_API_KEY (config.apiKey) not provided.');
        throw new Error('API key not provided for Gemini.');
    }
    const ai = new GoogleGenAI({ apiKey: config.apiKey });

    try {
        const { examples, userPrompt, outputFilenameHint } = await parsePromptTemplate(config.promptTemplatePath);

        if (!userPrompt) {
            console.error('Error: No prompt found in the template file.');
            return null;
        }
        if (!outputFilenameHint) {
            console.error('Error: No output filename hint found in the template file.');
            return null;
        }

        console.log(`User prompt: ${userPrompt}`);
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

        const fullPromptContents = [
            {
                role: 'user',
                parts: [
                    { text: systemPromptContent },
                    { text: '---\nGUIDELINES\n---\n' + instructions },
                    { text: '---\nEXAMPLES\n---\n' + (examples.length > 0 ? exampleContents : '\n(No examples provided in template)') },
                    canonicalIdentifierPart,
                    { text: '---\nUSER REQUEST\n---\n' + userPrompt },
                    { text: 'Ensure the SuperCollider code is complete and functional according to the guidelines. Ensure the JSON is well-formed and all required fields from the guidelines are present and correctly formatted. The SynthDef name in the SC code must be the basis for the \'name\' field in the JSON.' }
                ]
            }
        ];
        
        console.log('\n--- Full Prompt to Gemini API ---');
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
 * @returns {Promise<object|null>} A promise that resolves to an object { scCode, jsonContent, outputFilenameHint, success: boolean, tempScFilePath?: string, compilationSuccess?: boolean, compilationError?: string, error?: string } or null.
 */
async function generateAndValidateEffect(config) {
    let tempScFilePath = null; // Define here to be accessible in finally block if we add it
    try {
        console.log('Starting generation and validation process...');
        const generationResult = await generateEffectFromPrompt(config);

        if (!generationResult || !generationResult.scCode || !generationResult.jsonContent) {
            console.error('Generation failed or produced incomplete results.');
            return { ...generationResult, success: false, error: 'Generation failed or incomplete.' };
        }

        let compilationSuccess = false;
        let compilationError = null;
        let finalScPath = null;
        let finalJsonPath = null;

        if (generationResult.scCode && generationResult.outputFilenameHint) {
            const tempScFileName = `${generationResult.outputFilenameHint}_${Date.now()}.sc`;
            tempScFilePath = path.join(config.tempPath, tempScFileName);
            try {
                await fs.writeFile(tempScFilePath, generationResult.scCode);
                console.log(`Temporary SC file written to: ${tempScFilePath}`);

                try {
                    console.log(`Attempting to compile SC file: ${tempScFilePath}`);
                    await superColliderManager.loadScFile(tempScFilePath, config.effectsRepoPath, config.mainWindow);
                    console.log('SC file compiled successfully.');
                    compilationSuccess = true;

                    // If compilation is successful, save files to final destination
                    const scFileName = `${generationResult.outputFilenameHint}.sc`;
                    const jsonFileName = `${generationResult.outputFilenameHint}.json`;

                    finalScPath = path.join(config.effectsRepoPath, config.audioEffectsSubdir, scFileName);
                    finalJsonPath = path.join(config.effectsRepoPath, config.jsonEffectsSubdir, jsonFileName);

                    await fs.writeFile(finalScPath, generationResult.scCode);
                    console.log(`Successfully saved SuperCollider effect to: ${finalScPath}`);

                    await fs.writeFile(finalJsonPath, generationResult.jsonContent);
                    console.log(`Successfully saved JSON metadata to: ${finalJsonPath}`);

                } catch (scError) {
                    console.error('SC file compilation failed:', scError.message || scError);
                    compilationError = scError.message || (typeof scError === 'string' ? scError : 'Unknown SuperCollider compilation error');
                    compilationSuccess = false;
                }
            } catch (writeError) {
                console.error(`Error writing temporary SC file to ${tempScFilePath}:`, writeError);
                return { ...generationResult, success: false, error: `Failed to write temporary SC file: ${writeError.message}`, tempScFilePath: null, compilationSuccess: false };
            }
        } else {
            console.warn('No SC code or output filename hint available to write temporary file. Skipping compilation attempt.');
        }

        // Clean up temporary file if it was created
        if (tempScFilePath) {
            try {
                await fs.unlink(tempScFilePath);
                console.log(`Temporary SC file deleted: ${tempScFilePath}`);
            } catch (unlinkError) {
                console.warn(`Failed to delete temporary SC file ${tempScFilePath}:`, unlinkError.message);
            }
        }

        console.log(`Generation process finished. Overall success: ${generationResult && compilationSuccess}, Compilation success: ${compilationSuccess}`);
        return { 
            ...generationResult, 
            success: !!(generationResult && compilationSuccess), 
            tempScFilePath: null, // It's deleted or wasn't fully processed for saving
            finalScPath, 
            finalJsonPath,
            compilationSuccess, 
            compilationError 
        }; 

    } catch (error) {
        console.error('Error in generateAndValidateEffect:', error);
        // Ensure temp file is cleaned up even if an error occurs earlier in the process if possible
        if (tempScFilePath) {
            try {
                await fs.unlink(tempScFilePath);
                console.log(`Attempted to clean up temp SC file after error: ${tempScFilePath}`);
            } catch (unlinkError) {
                // Log but don't overshadow the original error
                console.warn(`Failed to delete temporary SC file ${tempScFilePath} during error cleanup:`, unlinkError.message);
            }
        }
        return { 
            success: false, 
            error: error.message || 'Unknown error during validation process.', 
            scCode: null, jsonContent: null, outputFilenameHint: null, tempScFilePath: null, 
            finalScPath: null, finalJsonPath: null,
            compilationSuccess: false, compilationError: error.message 
        };
    }
}

module.exports = {
    parsePromptTemplate,
    loadFileContent,
    parseGeminiResponse,
    generateEffectFromPrompt,
    generateAndValidateEffect,
}; 
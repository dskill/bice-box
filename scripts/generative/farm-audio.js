const { GoogleGenAI } = require('@google/genai');
const fs = require('fs').promises;
const path = require('path');

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable not set.');
    process.exit(1);
}

const EFFECTS_REPO_PATH = '/Users/drew/bice-box-effects'; // User confirmed path
const AUDIO_EFFECTS_SUBDIR = 'audio';
const JSON_EFFECTS_SUBDIR = 'effects';
const PROMPT_TEMPLATE_PATH = path.join(__dirname, 'farm_prompt_template.md');
const INSTRUCTIONS_PATH = path.join(__dirname, 'audio_effect_instructions.md');

const GEMINI_MODEL = 'gemini-2.5-pro-exp-03-25'; 
// eventually we want to switch to 'gemini-2.5-pro-preview-05-06';
// but that model isn't available via API just yet

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helper Functions ---

async function parsePromptTemplate() {
    try {
        const templateContent = await fs.readFile(PROMPT_TEMPLATE_PATH, 'utf-8');
        const sections = templateContent.split(/--- (EXAMPLES|PROMPT|OUTPUT FILENAME HINT) ---/);

        const examplesStr = sections.find((s, i) => sections[i-1] === 'EXAMPLES') || '';
        let promptStr = sections.find((s, i) => sections[i-1] === 'PROMPT') || '';
        let filenameHintStr = sections.find((s, i) => sections[i-1] === 'OUTPUT FILENAME HINT') || '';

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
        console.error(`Error parsing prompt template at ${PROMPT_TEMPLATE_PATH}:`, error);
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

// --- Main Farming Logic ---
async function farmAudioEffect() {
    console.log('Starting audio effect farming process...');

    try {
        const { examples, userPrompt, outputFilenameHint } = await parsePromptTemplate();

        if (!userPrompt) {
            console.error('Error: No prompt found in the template file.');
            return;
        }
        if (!outputFilenameHint) {
            console.error('Error: No output filename hint found in the template file.');
            return;
        }

        console.log(`User prompt: ${userPrompt}`);
        console.log(`Output filename hint: ${outputFilenameHint}`);
        console.log(`Found ${examples.length} example(s) to load.`);

        const instructions = await loadFileContent(INSTRUCTIONS_PATH);
        let exampleContents = '';

        for (const ex of examples) {
            const scPath = path.join(EFFECTS_REPO_PATH, AUDIO_EFFECTS_SUBDIR, ex.scFile);
            const jsonPath = path.join(EFFECTS_REPO_PATH, JSON_EFFECTS_SUBDIR, ex.jsonFile);
            
            const scExample = await loadFileContent(scPath);
            const jsonExample = await loadFileContent(jsonPath);

            exampleContents += `\n\n--- Example SC (${ex.scFile}) ---\n\`\`\`supercollider\n${scExample}\n\`\`\`\n`;
            exampleContents += `--- Example JSON (${ex.jsonFile}) ---\n\`\`\`json\n${jsonExample}\n\`\`\`\n`;
        }

        const systemPrompt = `You are an expert SuperCollider audio effect and Bice-Box JSON metadata generator. 
Your goal is to create a new SuperCollider audio effect (.sc file) and its corresponding Bice-Box JSON metadata file (.json) based on the user's request. 
Adhere STRICTLY to the provided guidelines and examples for both SuperCollider code and JSON structure. 
Output the SuperCollider code within a \`\`\`supercollider code block and the JSON content within a \`\`\`json code block. 
The JSON 'name'  should be a user-friendly, \`\`\`pretty\`\`\` name for the effect, suitable for display in the UI (e.g., \`\`\`Green Machine\`\`\`, \`\`\`Hyperdrive\`\`\`). The AI should infer this from the user prompt or the SynthDef name, converting it to a readable title case format.
The JSON 'visualizer' field MUST be "visual/oscilloscope.js".
The JSON 'audio' field MUST be the path to the generated .sc file, formatted as "audio/EFFECT_FILENAME.sc", where EFFECT_FILENAME.sc is the filename derived from the output filename hint (e.g., if the hint is 'my_effect', the path should be 'audio/my_effect.sc').`;

        const fullPromptContents = [
            {
                role: 'user',
                parts: [
                    { text: systemPrompt },
                    { text: '---\nGUIDELINES\n---\n' + instructions },
                    { text: '---\nEXAMPLES\n---' + (examples.length > 0 ? exampleContents : '\n(No examples provided in template)') },
                    { text: '---\nUSER REQUEST\n---\n' + userPrompt },
                    { text: 'Ensure the SuperCollider code is complete and functional according to the guidelines. Ensure the JSON is well-formed and all required fields from the guidelines are present and correctly formatted. The SynthDef name in the SC code must be the basis for the \'name\' field in the JSON.' }
                ]
            }
        ];
        
        console.log('\n--- Full Prompt to Gemini API ---');
        console.log(JSON.stringify(fullPromptContents, null, 2));
        // For a more concise view of just the text parts, you could also do:
        // console.log('\n--- Text Parts of Prompt to Gemini API ---');
        // fullPromptContents[0].parts.forEach(part => console.log(part.text + '\n---\n'));

        console.log('\nSending request to Gemini API...');

        const result = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: fullPromptContents
        });

        const responseText = result.text; 

        if (!responseText) {
            console.error('Error: Empty response from Gemini API.');
            return;
        }

        console.log('\nReceived response from Gemini. Parsing...');
        // console.log('Raw Gemini Response:\n', responseText); // For debugging

        const { scCode, jsonContent } = parseGeminiResponse(responseText);

        if (!scCode) {
            console.error('Failed to extract SuperCollider code from response. Aborting file save.');
            console.log("Full response for debugging:\n", responseText);
            return;
        }
        if (!jsonContent) {
            console.error('Failed to extract JSON content from response. Aborting file save.');
            console.log("Full response for debugging:\n", responseText);
            return;
        }

        // Log usage metadata
        if (result.usageMetadata) {
            console.log('\n--- API Usage Metadata ---');
            console.log(JSON.stringify(result.usageMetadata, null, 2));
        } else {
            console.log('\n(No usage metadata found in API response)');
        }

        // --- Save generated files ---
        const scFileName = `${outputFilenameHint}.sc`;
        const jsonFileName = `${outputFilenameHint}.json`;

        const scOutputPath = path.join(EFFECTS_REPO_PATH, AUDIO_EFFECTS_SUBDIR, scFileName);
        const jsonOutputPath = path.join(EFFECTS_REPO_PATH, JSON_EFFECTS_SUBDIR, jsonFileName);

        await fs.writeFile(scOutputPath, scCode);
        console.log(`Successfully saved SuperCollider effect to: ${scOutputPath}`);

        await fs.writeFile(jsonOutputPath, jsonContent);
        console.log(`Successfully saved JSON metadata to: ${jsonOutputPath}`);

        console.log('\nAudio effect farming process completed!');

    } catch (error) {
        console.error('\nAn error occurred during the farming process:', error);
        process.exitCode = 1;
    }
}

farmAudioEffect();
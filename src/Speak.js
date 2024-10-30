import
{
    IDLE,
    RECORDING,
    PROCESSING_STT,
    PROCESSING_GPT_RESPONSE,
    PROCESSING_TTS,
    SPEAKING,
} from './globalState';
import React, { useEffect, useRef } from 'react';
import { setGlobalFFT, setGlobalWaveform, setAvgWaveformIntensity } from './globalState'

const Speak = ({ state, transition, audioContextRef, gptSynthResponse }) => 
{
    // Edwin: EbHj6NvArso60yQrS9ya
    // Tyler: "QVUUYTvooRRo7aHIRKnv";
    // Matthew Bice: EzNCkqSLnUbs55V5yhiZ
    // Matthew Bicetastik: EKxG3oDJb1Nw6UQ87zrk
    // Harvey Denton: NiMwR3lv7cJIjqnzkUQb
    // Chad: smuMyFzCBUOkSZpsK0Kd

    const voiceId = "EzNCkqSLnUbs55V5yhiZ"; 
    const model = 'eleven_turbo_v2'; // can be eleven_multilingual_v1, eleven_multilingual_v2, or eleven_monolingual_v1
    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;
    const gainNodeRef = useRef(audioContextRef.current.createGain());
    let audioBufferQueue = [];
    let nextIndexToPlay = 0;
    let audioChunksReceived = 0;
    const sourceRef = useRef(null);
    let mediaRecorder = useRef(null);
    const socketRef = useRef(null);
    const analyserRef = useRef(null);

    useEffect(() =>
    {
        gainNodeRef.current.connect(audioContextRef.current.destination);

        // Cleanup function to disconnect the nodes when the component unmounts
        return () =>
        {
            gainNodeRef.current.disconnect();
        };
    }, []);

    const speakWithWebSocket = (textToSpeak) =>
    {
        if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED)
        {
            socketRef.current.close();
        }
        socketRef.current = new WebSocket(wsUrl);
        const socket = socketRef.current;

        socket.onopen = function (event)
        {
            const bosMessage = {
                "text": " ",
                "voice_settings": {
                    "stability": 0.25,
                    "similarity_boost": 0.7,
                    "style": 0.5,
                    "use_speaker_boost": true
                },
                "generation_config": {
                    "chunk_length_schedule": [120, 160, 250, 290]
                },
                "xi_api_key": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // replace with your API key
            };

            socket.send(JSON.stringify(bosMessage));

            const TextToSpeakMessage = {
                "text": textToSpeak,
                "try_trigger_generation": false,
                //"optimize_streaming_latency": 0
                //"output_format": "pcm_44100",
            };

            socket.send(JSON.stringify(TextToSpeakMessage));

            const eosMessage = {
                "text": ""
            };

            socket.send(JSON.stringify(eosMessage));
        };

        socket.onmessage = function (event)
        {
            const response = JSON.parse(event.data);
            //console.log("Server response:", response);

            if (response.audio)
            {
                const audioChunk = atob(response.audio);  // decode base64
                const arrayBuffer = new Uint8Array(audioChunk.length);
                for (let i = 0; i < audioChunk.length; i++)
                {
                    arrayBuffer[i] = audioChunk.charCodeAt(i);
                }

                const thisChunkIndex = audioChunksReceived;  // Capture the current index
                audioChunksReceived++;  // Increment the index for the next audio chunk

                console.log(`Received audio chunk ${thisChunkIndex}`);

                audioContextRef.current.decodeAudioData(arrayBuffer.buffer)
                    .then(audioBuffer =>
                    {
                        console.log("Decoding audio")
                        audioBufferQueue.push({ buffer: audioBuffer, index: thisChunkIndex });
                        audioBufferQueue.sort((a, b) => a.index - b.index);  // Sort the queue by index
                        transition(SPEAKING);
                        playNextBuffer();
                    })
                    .catch(error =>
                    {
                        console.error("Failed to decode audio data:", error);
                        transition(IDLE);
                    });

            } else
            {
                console.log("No audio data in the response");
                transition(IDLE);
            }

            if (response.normalizedAlignment)
            {
                // use the alignment info if needed
            }
        };


        function playNextBuffer()
        {
            if (audioBufferQueue.length === 0 || audioBufferQueue[0].index !== nextIndexToPlay)
            {
                return;  // No audio to play or next audio chunk in sequence not yet received
            }

            /*
            TODO: This is the source of the clicking between the chunks!  Rather than returning
            in this spot, we should queue up the next chunk to play at a fixed time after the
            current chunk.  
            From ChatGPT:

            "You can schedule the next audio buffer to start playing immediately after the current 
            one finishes. The AudioBufferSourceNode's start method takes an optional parameter to 
            delay the start time. You can use this to perfectly align the buffers."

            Below, where it waits until the last clip has played and then calls "source.start(0)"
            it needs to instead call source.start() NOW, but pass in a time.  Something like this:
                const now = audioContextRef.current.currentTime;
                if (endTime < now) {
                    endTime = now;  // No audio is currently scheduled
                }
                
                source.start(endTime);
                endTime += nextBuffer.duration;            

            CAVEAT: Do we need to do anything with the visualizer to make it only take effect when
            the clip actually plays?  Since we will be calling "start" on all our clips before
            they are actually playing that might mess something up?  Maybe not?
            */

            if (sourceRef.current)
            {
                return;
            }

            nextIndexToPlay++;

            const nextBufferObj = audioBufferQueue.shift();
            console.log(`Playing buffer ${nextBufferObj.index}`)

            const nextBuffer = nextBufferObj.buffer;
            sourceRef.current = audioContextRef.current.createBufferSource();
            sourceRef.current.buffer = nextBuffer;

            // Create and setup the analyser if it doesn't exist
            if (!analyserRef.current)
            {
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 512;
            }

            // Connect the source to the GainNode instead of destination
            sourceRef.current.connect(analyserRef.current); // Connect the source to the analyser
            analyserRef.current.connect(gainNodeRef.current); // Connect the analyser to the gain node
            sourceRef.current.connect(gainNodeRef.current); // Also connect the source to the gain node

            let animationFrameId;
            function draw()
            {
                // FFT data
                const fftData = new Float32Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getFloatFrequencyData(fftData);
                setGlobalFFT(fftData);

                // Waveform data
                const waveform = new Float32Array(analyserRef.current.fftSize);
                analyserRef.current.getFloatTimeDomainData(waveform);
                setGlobalWaveform(waveform);

                // Calculate average waveform intensity
                const avgWaveformIntensity = waveform.reduce((acc, value) => acc + Math.abs(value), 0) / waveform.length;
                setAvgWaveformIntensity(avgWaveformIntensity);

                animationFrameId = requestAnimationFrame(draw);
            }

            draw();

            if (audioContextRef.current.state === 'suspended')
            {
                audioContextRef.current.resume().then(() =>
                {
                    sourceRef.current.start();
                    sourceRef.current.onended = () =>
                    {
                        cancelAnimationFrame(animationFrameId); // Stop the visualisation
                        sourceRef.current = null;

                        if (audioBufferQueue.length === 0)
                        {
                            // If the queue is empty and this was the last buffer, transition to IDLE
                            transition(IDLE);
                        } else
                        {
                            // Otherwise, play the next buffer
                            playNextBuffer();
                        }
                    };

                });
            } else
            {
                sourceRef.current.start();
                sourceRef.current.onended = () =>
                {
                    cancelAnimationFrame(animationFrameId); // Stop the visualisation
                    sourceRef.current = null;

                    if (audioBufferQueue.length === 0)
                    {
                        // If the queue is empty and this was the last buffer, transition to IDLE
                        transition(IDLE);
                    } else
                    {
                        // Otherwise, play the next buffer
                        playNextBuffer();
                    }
                };

            }

            return () =>
            {
                cancelAnimationFrame(animationFrameId);
            };
        }

        // Handle errors
        socket.onerror = function (error)
        {
            console.error(`WebSocket Error: ${error}`);
        };

        // Handle socket closing
        socket.onclose = function (event)
        {
            if (event.wasClean)
            {
                console.info(`Connection closed cleanly, code=${event.code}, reason=${event.reason}`);
            } else
            {
                console.warn('Connection died');
            }
        };

        // Cleanup logic
        return () =>
        {
            console.log("closing connection");
            socket.close();
        };
    }

    useEffect(() =>
    {
        console.log("unmute");
        gainNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);

        if (state === PROCESSING_TTS)
        {
            const parsedResponse = JSON.parse(gptSynthResponse); // Parse the GPT response

            if (parsedResponse.explanation)
            {
                speakWithWebSocket(parsedResponse.explanation);
            } else {
                console.log("no valid response to speak")
            } 
            
        }

        if (state === RECORDING)
        {
            console.log("stopping audio while we are recording...");
            stopAndClearAudio(); // Stop any ongoing audio and clear the buffer
            console.log("mute");
            gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);

        }
    }, [state]);

    function stopAndClearAudio()
    {
        // Stop the current audio if source is valid
        if (sourceRef.current)
        {
            sourceRef.current.stop();
            sourceRef.current.onended = () => { };
            sourceRef.current = null;
        }

        // Clear the buffer queue
        audioBufferQueue = [];

        // Check if the socket is open before attempting to close it
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN)
        {
            console.log("closing socket");
            socketRef.current.close();
            socketRef.current = null;  // Clear the socket reference
        }
    }

    useEffect(() =>
    {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream =>
            {
                const recorder = new MediaRecorder(stream); // create a new recorder
                
                recorder.addEventListener('error', (e) =>
                {
                    console.error('MediaRecorder error:', e);
                });

                recorder.addEventListener('stop', onStopRecording); // use addEventListener
                mediaRecorder.current = recorder; // assign the recorder to the ref after setting event listeners
            })
            .catch(error =>
            {
                console.error('Error accessing microphone:', error);
            });
    }, []);

    function onStopRecording()
    {
        console.log("onStopRecording called");
    }

    return (
        null
    );
}

export default Speak;

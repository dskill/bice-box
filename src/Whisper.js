import
{
    IDLE,
    RECORDING,
    PROCESSING_STT,
    PROCESSING_GPT_RESPONSE,
    PROCESSING_TTS,
    SPEAKING,
} from './globalState';
import React, { useRef, useState, useEffect } from 'react';

const Whisper = ({ state, transition, setWhisperText }) =>
{
    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);
    const [openai_api_key, setOpenAIKey] = useState(null);
    const startTimeRef = useRef(null);
    const [audioDevices, setAudioDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');

    useEffect(() => {
        // Get the OpenAI key when component mounts
        const getKey = async () => {
            if (window.electron) {
                const key = await window.electron.ipcRenderer.getOpenAIKey();
                setOpenAIKey(key);
            }
        };
        getKey();
    }, []);

    useEffect(() => {
        // Fetch and set audio input devices
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const filteredDevices = devices.filter(device => device.kind === 'audioinput');
                setAudioDevices(filteredDevices);
                // Optionally, set the default microphone (if available)
                if (filteredDevices.length > 0) {
                    setSelectedDeviceId(filteredDevices[0].deviceId);
                }
            });
    }, []);

    useEffect(() =>
    {
        if ((state === RECORDING) && !mediaRecorder.current)
        {
            startRecording();
        } else if (mediaRecorder.current)
        {
            // stop recording after 1 second
            // this seems to do a better job of catching trailing words that otherwise get cut off
            setTimeout(() =>
            {
                stopRecording();
            }, 1000);
        }
    }, [state]);

    const handleDeviceChange = (event) => {
        setSelectedDeviceId(event.target.value);
    };

    const startRecording = () =>
    {
        // make sure we're starting with a blank slate
        audioChunks.current = [];
        
        const constraints = {
            audio: selectedDeviceId ? { deviceId: selectedDeviceId } : true
        };

        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream =>
            {
                mediaRecorder.current = new MediaRecorder(stream);
                mediaRecorder.current.ondataavailable = event =>
                {
                    audioChunks.current.push(event.data);
                };
                startTimeRef.current = Date.now();
                mediaRecorder.current.start(1000);
            });
    };

    const stopRecording = () =>
    {
        if (mediaRecorder.current)
        {
            mediaRecorder.current.stop();
            const duration = Date.now() - startTimeRef.current;
            mediaRecorder.current.stream.getTracks().forEach(track => track.stop()); // Stop all tracks to release the microphone
            mediaRecorder.current = null;

            // Check the duration of the recording
            if (state == PROCESSING_STT)
            {
                submitData(); // Manually call submitData function
            } else {
                audioChunks.current = [];
            }
        }
    };

    const submitData = async () =>
    {
        console.log("submitting data for transcription");
        const audioBlob = new Blob(audioChunks.current);
        const formData = new FormData();
        formData.append("file", audioBlob, "file.wav");
        formData.append("model", "whisper-1");

        try
        {
            const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                method: 'POST',
                body: formData,
                headers: {
                    'Authorization': `Bearer ${openai_api_key}`
                }
            });

            if (!response.ok)
            {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const transcriptionResponse = await response.json();
            console.log("Received:", transcriptionResponse.text);
            setWhisperText(transcriptionResponse.text)
            transition(PROCESSING_GPT_RESPONSE, true)

        } catch (error)
        {
            console.error("Error making request:", error);
        }

        // Clear the audio chunks after processing
        audioChunks.current = [];
    };

    return (
        <div>
            {/*<select className="custom-select" onChange={handleDeviceChange} value={selectedDeviceId.current}>
                {audioDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${device.deviceId}`}
                    </option>
                ))}
            </select>*/}
            {/* ... rest of your component ... */}
        </div>
    );
};

export default Whisper;

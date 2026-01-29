import React, { useRef, useState, useEffect } from 'react';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import ipcProxy from './ipcProxy';

const Whisper = ({ isRecording, onTranscriptionComplete }) => {
    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);
    const [openai, setOpenai] = useState(null);
    const startTimeRef = useRef(null);
    const [audioDevices, setAudioDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');

    useEffect(() => {
        const initOpenAI = async () => {
            try {
                const apiKey = await ipcProxy.getOpenAIKey();
                if (apiKey) {
                    setOpenai(new OpenAI({ apiKey, dangerouslyAllowBrowser: true }));
                }
            } catch (err) {
                console.error('Failed to get OpenAI key:', err);
            }
        };
        initOpenAI();
    }, []);

    useEffect(() => {
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const filteredDevices = devices.filter(device => device.kind === 'audioinput');
                setAudioDevices(filteredDevices);
                if (filteredDevices.length > 0) {
                    setSelectedDeviceId(filteredDevices[0].deviceId);
                }
            });
    }, []);

    useEffect(() => {
        if (isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    }, [isRecording]);

    const handleDeviceChange = (event) => {
        setSelectedDeviceId(event.target.value);
    };

    const startRecording = () => {
        if (mediaRecorder.current) return; 

        audioChunks.current = [];

        const constraints = {
            audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
        };

        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                mediaRecorder.current = new MediaRecorder(stream);
                mediaRecorder.current.ondataavailable = event => {
                    audioChunks.current.push(event.data);
                };
                startTimeRef.current = Date.now();
                mediaRecorder.current.start();
            }).catch(error => {
                console.error("Error starting recording:", error);
            });
    };

    const stopRecording = () => {
        if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
            mediaRecorder.current.onstop = () => {
                submitData();
                mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
                mediaRecorder.current = null;
            };
            mediaRecorder.current.stop();
        }
    };

    const submitData = async () => {
        if (!openai || audioChunks.current.length === 0) {
            return;
        }

        console.log("submitting data for transcription");
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
        audioChunks.current = []; 

        try {
            const file = await toFile(audioBlob, "file.wav");

            const transcription = await openai.audio.transcriptions.create({
                file: file,
                model: "whisper-1",
            });

            console.log("Received:", transcription.text);
            if (onTranscriptionComplete) {
                onTranscriptionComplete(transcription.text);
            }

        } catch (error) {
            console.error("Error making request:", error);
        }
    };

    return (
        <div>
            {/* You can add UI for device selection here if needed */}
            {/* 
            <select className="custom-select" onChange={handleDeviceChange} value={selectedDeviceId}>
                {audioDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${device.deviceId}`}
                    </option>
                ))}
            </select>
            */}
        </div>
    );
};

export default Whisper;

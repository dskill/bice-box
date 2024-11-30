import React, { useState, useEffect } from 'react';
import Button from './Button';
import ToggleButton from './ToggleButton'; // Import ToggleButton
import './App.css';
//import { FaSync, FaCheck, FaExclamationTriangle } from 'react-icons/fa';
// Removed unused import
// import {globalState} from './globalState';
const TempIcons = {
    FaSync: () => '↻',
    FaCheck: () => '✓',
    FaExclamationTriangle: () => '⚠'
};
const { FaSync, FaCheck, FaExclamationTriangle } = TempIcons;


const electron = window.electron;

function EffectManagement({ reloadEffectList, pullEffectsRepo, currentSynth, switchSynth, effectsRepoStatus, onCheckEffectsRepo })
{
    const [inputAudioDevices, setInputAudioDevices] = useState([]);
    const [outputAudioDevices, setOutputAudioDevices] = useState([]);
    const [selectedInputDevice, setSelectedInputDevice] = useState('');
    const [selectedOutputDevice, setSelectedOutputDevice] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const [ipAddress, setIpAddress] = useState('');

    useEffect(() =>
    {
        console.log("Component mounted, electron object:", electron);
        if (electron && electron.ipcRenderer)
        {
            const handleIpAddressReply = (address) =>
            {
                console.log("IP address received:", address);
                setIpAddress(address);
            };

            electron.ipcRenderer.on('ip-address-reply', handleIpAddressReply);
            fetchIp();

            return () =>
            {
                electron.ipcRenderer.removeListener('ip-address-reply', handleIpAddressReply);
            };
        } else
        {
            console.warn("Electron or ipcRenderer not available");
        }
    }, []);

    const fetchIp = () =>
    {
        console.log("Fetching IP address...");
        if (!electron || !electron.ipcRenderer)
        {
            console.warn('Electron or ipcRenderer is not available');
            setErrorMessage('Electron is not available');
            return Promise.reject(new Error('Electron is not available'));
        }

        return new Promise((resolve, reject) =>
        {
            electron.ipcRenderer.send('get-ip-address');
            console.log("get-ip-address IPC message sent");

            const timeoutId = setTimeout(() =>
            {
                reject(new Error("Timeout while waiting for IP address"));
            }, 5000);

            electron.ipcRenderer.once('ip-address-reply', (address) =>
            {
                clearTimeout(timeoutId);
                if (address)
                {
                    console.log("IP address received:", address);
                    setIpAddress(address);
                    resolve(address);
                } else
                {
                    console.error("Failed to fetch IP address");
                    setErrorMessage('Failed to fetch IP address');
                    reject(new Error('Failed to fetch IP address'));
                }
            });
        });
    };

    const fetchAudioDevices = async () =>
    {
        try
        {
            console.log("fetch audio devices function called");
            if (!electron)
            {
                console.warn('Electron is not available');
                setErrorMessage('Electron is not available');
                return;
            }

            return new Promise((resolve, reject) =>
            {
                electron.ipcRenderer.send('get-audio-devices');
                electron.ipcRenderer.once('audio-devices-reply', (devices) =>
                {
                    console.log("audio devices received:", devices);
                    if (Array.isArray(devices) && devices.length > 0)
                    {
                        console.log('Setting audio devices:', devices);
                        setInputAudioDevices(devices);
                        setOutputAudioDevices(devices);
                        // Set the first device as selected if not already set
                        if (!selectedInputDevice) setSelectedInputDevice(devices[0]);
                        if (!selectedOutputDevice) setSelectedOutputDevice(devices[0]);
                        setErrorMessage('');
                        resolve(devices);
                    } else
                    {
                        setInputAudioDevices([]);
                        setOutputAudioDevices([]);
                        setSelectedInputDevice('');
                        setSelectedOutputDevice('');
                        setErrorMessage('No audio devices found. Please check your audio settings.');
                        resolve([]);
                    }
                });
            });
        } catch (error)
        {
            console.error("Error fetching audio devices:", error);
            setInputAudioDevices([]);
            setOutputAudioDevices([]);
            setErrorMessage(error?.message || 'Error fetching audio devices');
        }
    };

    useEffect(() =>
    {
        if (electron)
        {
            fetchAudioDevices().catch(error =>
            {
                console.error("Error fetching audio devices:", error);
                setErrorMessage(error?.message || 'Error fetching audio devices');
            });
        }
    }, []);

    const rebootServer = () =>
    {
        if (electron)
        {
            electron.ipcRenderer.send('reboot-server');
        }
    }

    const handleInputDeviceChange = (event) =>
    {
        const selectedDevice = event.target.value;
        setSelectedInputDevice(selectedDevice);
        if (electron)
        {
            electron.ipcRenderer.send('set-audio-devices', { inputDevice: selectedDevice, outputDevice: selectedOutputDevice });
        }
    };

    const handleOutputDeviceChange = (event) =>
    {
        const selectedDevice = event.target.value;
        setSelectedOutputDevice(selectedDevice);
        if (electron)
        {
            electron.ipcRenderer.send('set-audio-devices', { inputDevice: selectedInputDevice, outputDevice: selectedDevice });
        }
    };

    const refreshDevices = () =>
    {
        fetchAudioDevices();
        fetchIp();
    };

    const toggleAccordion = () =>
    {
        setIsExpanded(!isExpanded);
    };

    const handlePullEffectsRepo = () =>
    {
        pullEffectsRepo()
            .then(() =>
            {
                console.log('Effects repo updated and reloaded successfully');
            })
            .catch(error =>
            {
                console.error('Failed to update and reload effects:', error);
                setErrorMessage(error?.message || 'Failed to update and reload effects');
            });
    };

    const handleReloadCurrentEffect = () =>
    {
        if (currentSynth && currentSynth.name)
        {
            switchSynth(currentSynth.name);
        } else
        {
            setErrorMessage('No current effect selected to reload');
        }
    };

    const renderSyncButton = () => {
        if (effectsRepoStatus.isChecking) {
            return (
                <Button
                    label={<><FaSync className="spin" /> Checking for Updates</>}
                    disabled={true}
                />
            );
        }

        if (effectsRepoStatus.error) {
            return (
                <Button
                    label={<><FaExclamationTriangle /> Check Failed - Retry</>}
                    onClick={() => {
                        // Clear error state and retry
                        onCheckEffectsRepo();
                    }}
                    className="error-button"
                />
            );
        }

        if (effectsRepoStatus.hasUpdates) {
            return (
                <Button
                    label={<>↓ Sync Latest Effects</>}
                    onClick={handlePullEffectsRepo}
                    className="update-available"
                />
            );
        }

        return (
            <Button
                label={<><FaCheck /> Effects Up to Date</>}
                onClick={onCheckEffectsRepo}
                className="up-to-date"
            />
        );
    };

    return (
        <div className="supercollider-boot-management">
            <ToggleButton
                isOn={isExpanded}
                setIsOn={setIsExpanded}
                onText="Hide Tools"
                offText="Tools"
            />

            {isExpanded && (
                <div className="management-content">
                     <div className="ip-address">
                        <p>Device IP: {ipAddress}</p>
                    </div>
                    <div className="button-column">
                        <Button label={"Reload All Effects"} onClick={reloadEffectList} />
                        <Button label={"Reload Current Effect"} onClick={handleReloadCurrentEffect} />
                        <Button label={"Git Pull Effects"} onClick={handlePullEffectsRepo} />
                        <Button label={"Refresh Devices"} onClick={refreshDevices} />
                        <Button label={"Reboot Server"} onClick={rebootServer} />
                        {renderSyncButton()}
                    </div>

                   

                    <div className="device-selectors">
                        <div>
                            <label>Input Device: </label>
                            <select className="custom-select" onChange={handleInputDeviceChange} value={selectedInputDevice}>
                                {inputAudioDevices.length === 0 && <option value="">No Devices Found</option>}
                                {inputAudioDevices.map(device => (
                                    <option key={device} value={device}>{device}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label>Output Device: </label>
                            <select className="custom-select" onChange={handleOutputDeviceChange} value={selectedOutputDevice}>
                                {outputAudioDevices.length === 0 && <option value="">No Devices Found</option>}
                                {outputAudioDevices.map(device => (
                                    <option key={device} value={device}>{device}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="button-column">
                    </div>

                    {errorMessage && <div className="error-message">{errorMessage}</div>}
                </div>
            )}
        </div>
    );
}

export default EffectManagement;

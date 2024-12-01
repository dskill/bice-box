import React, { useState, useEffect } from 'react';
import Button from './Button';
import ToggleButton from './ToggleButton'; // Import ToggleButton
import './App.css';
import { FaSync, FaCheck, FaExclamationTriangle } from 'react-icons/fa';
/*const TempIcons = {
    FaSync: () => '↻',
    FaCheck: () => '✓',
    FaExclamationTriangle: () => '⚠'
};
const { FaSync, FaCheck, FaExclamationTriangle } = TempIcons;
*/

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
    const [version, setVersion] = useState('');
    const [isPulling, setIsPulling] = useState(false);
    const [appUpdateStatus, setAppUpdateStatus] = useState({ hasUpdate: false, currentVersion: '', latestVersion: '' });
    const [isUpdatingApp, setIsUpdatingApp] = useState(false);

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

            const handleVersionReply = (ver) =>
            {
                console.log("Version received:", ver);
                setVersion(ver);
            };

            electron.ipcRenderer.on('ip-address-reply', handleIpAddressReply);
            electron.ipcRenderer.on('version-reply', handleVersionReply);
            fetchIp();
            fetchVersion();

            return () =>
            {
                electron.ipcRenderer.removeListener('ip-address-reply', handleIpAddressReply);
                electron.ipcRenderer.removeListener('version-reply', handleVersionReply);
            };
        } else
        {
            console.warn("Electron or ipcRenderer not available");
        }
    }, []);

    useEffect(() => {
        // Wait a short moment after mount before checking effects repo
        const timer = setTimeout(() => {
            if (electron && electron.ipcRenderer) {
                onCheckEffectsRepo();
            }
        }, 1500); // 1.5 second delay

        return () => clearTimeout(timer);
    }, []); // Only run once on mount

    useEffect(() => {
        if (electron && electron.ipcRenderer) {
            const handleAppUpdateStatus = (status) => {
                setAppUpdateStatus(status);
            };

            electron.ipcRenderer.on('app-update-status', handleAppUpdateStatus);
            electron.ipcRenderer.on('app-update-error', (error) => {
                setErrorMessage(`App update failed: ${error}`);
                setIsUpdatingApp(false);
            });

            // Initial check
            electron.ipcRenderer.send('check-app-update');

            return () => {
                electron.ipcRenderer.removeListener('app-update-status', handleAppUpdateStatus);
                electron.ipcRenderer.removeListener('app-update-error', () => {});
            };
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

    const fetchVersion = () =>
    {
        if (electron && electron.ipcRenderer)
        {
            electron.ipcRenderer.send('get-version');
        }
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

    const handlePullEffectsRepo = () => {
        setIsPulling(true);
        pullEffectsRepo()
            .then(() => {
                console.log('Effects repo updated and reloaded successfully');
                // Add a small delay before checking status again
                setTimeout(() => {
                    handleCheckEffectsRepo();
                    setIsPulling(false);
                }, 1000);
            })
            .catch(error => {
                console.error('Failed to update and reload effects:', error);
                setErrorMessage(error?.message || 'Failed to update and reload effects');
                setIsPulling(false);
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

    const handleCheckEffectsRepo = () => {
        if (!electron || !electron.ipcRenderer) {
            console.warn('Electron IPC not ready yet');
            return;
        }
        onCheckEffectsRepo();
    };

    const handleUpdateApp = () => {
        setIsUpdatingApp(true);
        electron.ipcRenderer.send('update-app');
    };

    const handleQuit = () => {
        if (electron && electron.ipcRenderer) {
            electron.ipcRenderer.send('quit-app');
        }
    };

    const renderSyncButton = () => {
        if (isPulling) {
            return (
                <Button
                    label={<><FaSync className="spin" /> Updating Effects</>}
                    disabled={true}
                />
            );
        }

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
                    onClick={handleCheckEffectsRepo}
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
                onClick={handleCheckEffectsRepo}
                className="up-to-date"
            />
        );
    };

    const renderAppUpdateButton = () => {
        if (isUpdatingApp) {
            return (
                <Button
                    label={<><FaSync className="spin" /> Updating App...</>}
                    disabled={true}
                />
            );
        }

        if (appUpdateStatus.hasUpdate) {
            return (
                <Button
                    label={<>↑ Update App to {appUpdateStatus.latestVersion}</>}
                    onClick={handleUpdateApp}
                    className="update-available"
                />
            );
        }

        return (
            <Button
                label={<><FaCheck /> App Up to Date</>}
                onClick={() => electron.ipcRenderer.send('check-app-update')}
                className="up-to-date"
            />
        );
    };

    // Add this effect to perform all checks when menu opens
    useEffect(() => {
        if (isExpanded) {
            // Check IP
            fetchIp();
            
            // Check app updates
            if (electron && electron.ipcRenderer) {
                electron.ipcRenderer.send('check-app-update');
            }
            
            // Check effects repo
            handleCheckEffectsRepo();
        }
    }, [isExpanded]); // Only re-run when isExpanded changes

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
                        <p>Version: {version}</p>
                    </div>
                    <div className="button-column">
                        <Button label={"Reload All Effects"} onClick={reloadEffectList} />
                        <Button label={"Reload Current Effect"} onClick={handleReloadCurrentEffect} />
                        <Button label={"Git Pull Effects"} onClick={handlePullEffectsRepo} />
                        <Button label={"Refresh Devices"} onClick={refreshDevices} />
                        <Button label={"Reboot Server"} onClick={rebootServer} />
                        {renderSyncButton()}
                        {renderAppUpdateButton()}
                        <Button label={"Quit"} onClick={handleQuit} className="quit-button" />
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

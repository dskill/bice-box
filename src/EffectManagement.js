import React, { useState, useEffect } from 'react';
import Button from './Button';
import ToggleButton from './ToggleButton'; // Import ToggleButton
import WifiSettings from './WifiSettings'; // Import WifiSettings
import './App.css';
import { FaSync, FaCheck, FaExclamationTriangle, FaDownload, FaWifi } from 'react-icons/fa';
import ReactDOM from 'react-dom';

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
    const [hasUpdates, setHasUpdates] = useState(false);
    const [showWifiSettings, setShowWifiSettings] = useState(false);
    const [wifiStatus, setWifiStatus] = useState({ connected: false, ssid: null });
    const [devMode, setDevMode] = useState(false);

    useEffect(() =>
    {
        console.log("Component mounted, electron object:", electron);
        if (electron && electron.ipcRenderer)
        {
            const handleIpAddressReply = (event, address) =>
            {
                console.log("IP address received:", address);
                setIpAddress(address);
            };

            const handleVersionReply = (event, ver) =>
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

    useEffect(() =>
    {
        // Wait a short moment after mount before checking effects repo
        const timer = setTimeout(() =>
        {
            if (electron && electron.ipcRenderer)
            {
                onCheckEffectsRepo();
            }
        }, 1500); // 1.5 second delay

        return () => clearTimeout(timer);
    }, []); // Only run once on mount

    useEffect(() =>
    {
        if (electron && electron.ipcRenderer)
        {
            const handleAppUpdateStatus = (event, status) =>
            {
                setAppUpdateStatus(status);
                setIsUpdatingApp(false);
            };

            electron.ipcRenderer.on('app-update-status', handleAppUpdateStatus);
            electron.ipcRenderer.on('app-update-error', (event, error) =>
            {
                setErrorMessage(`App update failed: ${error}`);
                setIsUpdatingApp(false);
            });

            // Initial check
            electron.ipcRenderer.send('check-app-update');

            return () =>
            {
                electron.ipcRenderer.removeListener('app-update-status', handleAppUpdateStatus);
                electron.ipcRenderer.removeListener('app-update-error', () => { });
            };
        }
    }, []);

    useEffect(() => {
        if (electron && electron.ipcRenderer) {
            const handleWifiStatus = (event, status) => {
                setWifiStatus(status);
                // Refresh IP when WiFi status changes
                fetchIp();
            };

            electron.ipcRenderer.on('wifi-status', handleWifiStatus);
            electron.ipcRenderer.send('check-wifi-status');

            return () => {
                electron.ipcRenderer.removeListener('wifi-status', handleWifiStatus);
            };
        }
    }, []);

    useEffect(() => {
        if (electron && electron.ipcRenderer) {
            // Get initial state
            electron.ipcRenderer.invoke('get-dev-mode').then(setDevMode);

            // Listen for changes
            const handleModeChange = (event, newMode) => {
                console.log('Dev mode changed:', newMode);
                setDevMode(newMode);
            };

            electron.ipcRenderer.on('dev-mode-changed', handleModeChange);

            return () => {
                electron.ipcRenderer.removeListener('dev-mode-changed', handleModeChange);
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

            electron.ipcRenderer.once('ip-address-reply', (event, address) =>
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
                electron.ipcRenderer.once('audio-devices-reply', (event, devices) =>
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

    /*
    useEffect(() => {
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 2000; // 2 seconds

        const tryFetchDevices = () => {
            if (electron) {
                fetchAudioDevices()
                    .catch(error => {
                        console.error(`Error fetching audio devices (attempt ${retryCount + 1}/${maxRetries}):`, error);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            setTimeout(tryFetchDevices, retryDelay);
                        } else {
                            setErrorMessage(error?.message || 'Failed to fetch audio devices after multiple attempts');
                        }
                    });
            }
        };

        tryFetchDevices();

        // Cleanup timeout on unmount
        return () => {
            retryCount = maxRetries; // Prevent any pending retries
        };
    }, []);
    */

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
        setIsPulling(true);
        pullEffectsRepo()
            .then(() =>
            {
                console.log('Effects repo updated and reloaded successfully');
                // Add a small delay before checking status again
                setTimeout(() =>
                {
                    handleCheckEffectsRepo();
                    setIsPulling(false);
                }, 1000);
            })
            .catch(error =>
            {
                console.error('Failed to update and reload effects:', error);
                setErrorMessage(error?.message || 'Failed to update and reload effects');
                setIsPulling(false);
            });
    };

    const handleCheckEffectsRepo = () =>
    {
        if (!electron || !electron.ipcRenderer)
        {
            console.warn('Electron IPC not ready yet');
            return;
        }
        onCheckEffectsRepo();
    };

    const handleUpdateApp = () =>
    {
        setIsUpdatingApp(true);
        electron.ipcRenderer.send('update-app');
    };

    const handleQuit = () =>
    {
        if (electron && electron.ipcRenderer)
        {
            electron.ipcRenderer.send('quit-app');
        }
    };

    const handleCheckUpdate = () => {
        setIsUpdatingApp(true);
        electron.ipcRenderer.send('check-app-update');
        
        setTimeout(() => {
            setIsUpdatingApp(false);
        }, 5000);
    };

    const renderSyncButton = () =>
    {
        if (isPulling)
        {
            return (
                <Button
                    label={<><FaSync className="spin" /> Updating Effects</>}
                    disabled={true}
                />
            );
        }

        if (effectsRepoStatus.isChecking)
        {
            return (
                <Button
                    label={<><FaSync className="spin" /> Checking for Updates</>}
                    disabled={true}
                />
            );
        }

        if (effectsRepoStatus.error)
        {
            return (
                <Button
                    label={<><FaExclamationTriangle /> Check Failed - Please Retry</>}
                    onClick={handleCheckEffectsRepo}
                    className="error-button"
                />
            );
        }

        if (effectsRepoStatus.hasUpdates)
        {
            return (
                <Button
                    label={<><FaDownload style={{ color: '#ff8c00' }} /> Sync Latest Effects</>}
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

    const renderAppUpdateButton = () =>
    {
        if (isUpdatingApp)
        {
            return (
                <Button
                    label={<><FaSync className="spin" /> Checking for Updates...</>}
                    disabled={true}
                />
            );
        }

        if (appUpdateStatus.hasUpdate)
        {
            return (
                <Button
                    //onClick={handleUpdateApp}
                    label={<><FaDownload /> Reboot to Apply</>}
                    className="update-available"
                />
            );
        }

        return (
            <Button
                label={<><FaCheck /> App Up to Date</>}
                onClick={handleCheckUpdate}
                className="up-to-date"
            />
        );
    };

    const renderWifiButton = () => (
        <Button 
            label={
                <>
                    {wifiStatus.connected ? (
                        <><FaWifi /> WiFi: {wifiStatus.ssid}</>
                    ) : (
                        <><FaWifi style={{ color: '#ff8c00' }} /> WiFi Settings</>
                    )}
                </>
            }
            onClick={handleWifiButtonClick}
        />
    );

    // Run checks on mount and when menu expands
    useEffect(() =>
    {
        const runChecks = () =>
        {
            // Check IP
            fetchIp();

            // Check app updates
            if (electron && electron.ipcRenderer)
            {
                electron.ipcRenderer.send('check-app-update');
            }

            // Check effects repo
            onCheckEffectsRepo();
        };

        // Run on mount
        runChecks();

        // Also run when menu is expanded
        if (isExpanded)
        {
            runChecks();
        }
    }, [isExpanded]); // Run on mount and when isExpanded changes

    // Keep update status in sync
    useEffect(() =>
    {
        setHasUpdates(effectsRepoStatus.hasUpdates || appUpdateStatus.hasUpdate);
    }, [effectsRepoStatus.hasUpdates, appUpdateStatus.hasUpdate]);

    const handleWifiButtonClick = () => {
        setShowWifiSettings(true);
    };

    const handleWrapperClick = (e) => {
        // Only close if clicking the wrapper itself, not its children
        if (e.target === e.currentTarget) {
            setIsExpanded(false);
        }
    };

    const handleDevModeToggle = () => {
        electron.ipcRenderer.send('toggle-dev-mode');
        reloadEffectList();
    };

    return (
        <div 
            className={`effect-management-modal ${isExpanded ? 'effect-management-modal--expanded' : ''}`}
            onClick={handleWrapperClick}
        >
            <div className="effect-management">
            <ToggleButton 
                isOn={isExpanded}
                setIsOn={setIsExpanded}
                onText="Close"
                offText="Settings"
                hasUpdates={hasUpdates}
                className="effect-management__toggle tools-toggle"
            />

            <div className={`effect-management__content ${isExpanded ? 'effect-management__content--expanded' : ''}`}>
                <div className="effect-management__buttons">
                    {renderWifiButton()}
                    {renderAppUpdateButton()}
                    {renderSyncButton()}
                    <Button 
                        label={devMode ? "Disable Dev Mode" : "Enable Dev Mode"}
                        onClick={handleDevModeToggle}
                        className={devMode ? "dev-mode-on" : ""}
                    />
                    
                    {devMode && (
                        <>
                            <Button label={"Reload All Effects"} onClick={reloadEffectList} />
                            <Button label={"Reboot Server"} onClick={rebootServer} />
                        </>
                    )}
                </div>
                {errorMessage && <div className="effect-management__error">{errorMessage}</div>}
                <div className="effect-management__info">
                    <p>Device IP: {ipAddress}</p>
                    <p>Version: {version}</p>
                </div>
                
                {/* Device selectors temporarily disabled
                <div className="effect-management__device-selectors">
                    <div>
                        <label>Input Device: </label>
                        <select className="effect-management__select" onChange={handleInputDeviceChange} value={selectedInputDevice}>
                            {inputAudioDevices.length === 0 && <option value="">No Devices Found</option>}
                            {inputAudioDevices.map(device => (
                                <option key={device} value={device}>{device}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label>Output Device: </label>
                        <select className="effect-management__select" onChange={handleOutputDeviceChange} value={selectedOutputDevice}>
                            {outputAudioDevices.length === 0 && <option value="">No Devices Found</option>}
                            {outputAudioDevices.map(device => (
                                <option key={device} value={device}>{device}</option>
                            ))}
                        </select>
                    </div>
                </div>
                */}
              

            </div>
            
            {/* Render WiFi settings modal when showWifiSettings is true. Use createPortal to mount it at document.body 
                level to ensure proper z-index stacking and overlay behavior */}
            {showWifiSettings && ReactDOM.createPortal(
                <WifiSettings onClose={() => setShowWifiSettings(false)} />,
                document.body
            )}
            </div>
        </div>
    );
}

export default EffectManagement;

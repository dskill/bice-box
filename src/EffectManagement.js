import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { FaSync, FaCheck, FaExclamationTriangle, FaDownload, FaWifi, FaCodeBranch } from 'react-icons/fa';
import QRCode from 'react-qr-code';
import Button from './Button';
import ToggleButton from './ToggleButton';
import WifiSettings from './WifiSettings';
import CommitPreview from './CommitPreview';
import './App.css';

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
    // Auto-update state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
    const [autoUpdateState, setAutoUpdateState] = useState({
        status: 'idle',
        version: null,
        downloadPercent: 0,
        error: null
    });
    const [hasUpdates, setHasUpdates] = useState(false);
    const [showWifiSettings, setShowWifiSettings] = useState(false);
    const [wifiStatus, setWifiStatus] = useState({ connected: false, ssid: null });
    const [devMode, setDevMode] = useState(false);
    const [availableBranches, setAvailableBranches] = useState([]);
    const [currentBranch, setCurrentBranch] = useState('');
    const [hasLocalChanges, setHasLocalChanges] = useState(false);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
    const [showBranchSelector, setShowBranchSelector] = useState(false);
    const [showCommitPreview, setShowCommitPreview] = useState(false);
    const [isPlatformRaspberryPi, setIsPlatformRaspberryPi] = useState(false);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) {
            console.warn("Electron or ipcRenderer not available");
            return;
        }

        const handleIpAddressReply = (event, address) => {
            setIpAddress(address);
        };

        const handleVersionReply = (event, ver) => {
            setVersion(ver);
        };

        electron.ipcRenderer.on('ip-address-reply', handleIpAddressReply);
        electron.ipcRenderer.on('version-reply', handleVersionReply);

        electron.ipcRenderer.send('get-ip-address');
        electron.ipcRenderer.send('get-version');

        return () => {
            electron.ipcRenderer.removeListener('ip-address-reply', handleIpAddressReply);
            electron.ipcRenderer.removeListener('version-reply', handleVersionReply);
        };
    }, []);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) return;

        const timer = setTimeout(() => onCheckEffectsRepo(), 1500);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) return;

        const handleAutoUpdateStatus = (event, data) => {
            const { status, version, percent, message, currentVersion } = data;
            setAutoUpdateState(prev => ({
                ...prev,
                status: status || prev.status,
                version: version || prev.version,
                downloadPercent: percent || 0,
                error: status === 'error' ? message : null
            }));
            if (status === 'error') {
                setErrorMessage(`App update failed: ${message}`);
            }
        };

        electron.ipcRenderer.on('auto-update-status', handleAutoUpdateStatus);

        return () => {
            electron.ipcRenderer.removeListener('auto-update-status', handleAutoUpdateStatus);
        };
    }, []);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) return;

        const handleWifiStatus = (event, status) => {
            setWifiStatus(status);
            electron.ipcRenderer.send('get-ip-address');
        };

        electron.ipcRenderer.on('wifi-status', handleWifiStatus);
        electron.ipcRenderer.send('check-wifi-status');

        return () => {
            electron.ipcRenderer.removeListener('wifi-status', handleWifiStatus);
        };
    }, []);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) return;

        electron.ipcRenderer.invoke('get-dev-mode').then(setDevMode);

        const handleModeChange = (event, newMode) => {
            setDevMode(newMode);
        };

        electron.ipcRenderer.on('dev-mode-changed', handleModeChange);

        return () => {
            electron.ipcRenderer.removeListener('dev-mode-changed', handleModeChange);
        };
    }, []);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) return;

        electron.ipcRenderer.invoke('get-platform-info').then(info => {
            if (info?.isPi !== undefined) {
                setIsPlatformRaspberryPi(info.isPi);
            }
        });
    }, []);

    const refreshIpAddress = () => {
        if (electron?.ipcRenderer) {
            electron.ipcRenderer.send('get-ip-address');
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

    const rebootServer = () => {
        electron?.ipcRenderer?.send('reboot-server');
    };

    const resetClaudeConversation = () => {
        electron?.ipcRenderer?.send('reset-claude-session');
    };

    const handleInputDeviceChange = (event) => {
        const selectedDevice = event.target.value;
        setSelectedInputDevice(selectedDevice);
        electron?.ipcRenderer?.send('set-audio-devices', {
            inputDevice: selectedDevice,
            outputDevice: selectedOutputDevice
        });
    };

    const handleOutputDeviceChange = (event) => {
        const selectedDevice = event.target.value;
        setSelectedOutputDevice(selectedDevice);
        electron?.ipcRenderer?.send('set-audio-devices', {
            inputDevice: selectedInputDevice,
            outputDevice: selectedDevice
        });
    };

    const refreshDevices = () => {
        fetchAudioDevices();
        refreshIpAddress();
    };

    const fetchGitBranches = () => {
        if (!electron?.ipcRenderer) return;

        electron.ipcRenderer.send('get-git-branches');
        electron.ipcRenderer.once('git-branches-reply', (event, data) => {
            setAvailableBranches(data.branches);
            setCurrentBranch(data.currentBranch);
        });
        electron.ipcRenderer.once('git-branches-error', (event, error) => {
            console.error('Failed to fetch branches:', error);
            setErrorMessage(`Failed to fetch branches: ${error}`);
        });
    };

    const checkLocalChanges = () => {
        if (!electron?.ipcRenderer) return;

        electron.ipcRenderer.send('check-git-local-changes');
        electron.ipcRenderer.once('git-local-changes-reply', (event, data) => {
            setHasLocalChanges(data.hasLocalChanges);
        });
        electron.ipcRenderer.once('git-local-changes-error', (event, error) => {
            console.error('Failed to check local changes:', error);
        });
    };

    const handleBranchChange = (newBranch) => {
        if (newBranch === currentBranch) return;

        setIsSwitchingBranch(true);
        electron.ipcRenderer.send('switch-git-branch', newBranch);

        electron.ipcRenderer.once('switch-branch-success', (event, data) => {
            setCurrentBranch(data.branch);
            setIsSwitchingBranch(false);
            reloadEffectList();
            checkLocalChanges();
        });

        electron.ipcRenderer.once('switch-branch-error', (event, error) => {
            console.error('Failed to switch branch:', error);
            setErrorMessage(`Failed to switch branch: ${error}`);
            setIsSwitchingBranch(false);
        });
    };

    useEffect(() => {
        const hasConnectivity = !isPlatformRaspberryPi || wifiStatus.connected;
        if (!electron?.ipcRenderer || !hasConnectivity) return;

        fetchGitBranches();
        checkLocalChanges();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wifiStatus.connected, isPlatformRaspberryPi]);

    const handlePullEffectsRepo = () => {
        setIsPulling(true);
        pullEffectsRepo()
            .then(() => {
                setTimeout(() => {
                    onCheckEffectsRepo();
                    setIsPulling(false);
                }, 1000);
            })
            .catch(error => {
                console.error('Failed to update and reload effects:', error);
                setErrorMessage(error?.message || 'Failed to update and reload effects');
                setIsPulling(false);
            });
    };

    const handleCheckUpdate = async () => {
        if (!electron?.ipcRenderer) return;
        setAutoUpdateState(prev => ({ ...prev, status: 'checking' }));
        try {
            await electron.ipcRenderer.invoke('check-for-updates');
        } catch (err) {
            setAutoUpdateState(prev => ({ ...prev, status: 'error', error: err.message }));
        }
    };

    const handleDownloadUpdate = async () => {
        if (!electron?.ipcRenderer) return;
        try {
            await electron.ipcRenderer.invoke('download-update');
        } catch (err) {
            setAutoUpdateState(prev => ({ ...prev, status: 'error', error: err.message }));
        }
    };

    const handleInstallUpdate = () => {
        if (!electron?.ipcRenderer) return;
        electron.ipcRenderer.invoke('install-update');
    };

    const handleQuit = () => {
        electron?.ipcRenderer?.send('quit-app');
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
                    onClick={onCheckEffectsRepo}
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
                onClick={onCheckEffectsRepo}
                className="up-to-date"
            />
        );
    };

    const renderAppUpdateButton = () => {
        const { status, version, downloadPercent } = autoUpdateState;

        switch (status) {
            case 'checking':
                return (
                    <Button
                        label={<><FaSync className="spin" /> Checking for Updates...</>}
                        disabled={true}
                    />
                );
            case 'available':
                return (
                    <Button
                        onClick={handleDownloadUpdate}
                        label={<><FaDownload style={{ color: '#ff8c00' }} /> Download v{version}</>}
                        className="update-available"
                    />
                );
            case 'downloading':
                return (
                    <Button
                        label={<><FaSync className="spin" /> Downloading {downloadPercent}%</>}
                        disabled={true}
                    />
                );
            case 'ready':
                return (
                    <Button
                        onClick={handleInstallUpdate}
                        label={<><FaDownload style={{ color: '#4CAF50' }} /> Install &amp; Restart</>}
                        className="update-ready"
                    />
                );
            case 'error':
                return (
                    <Button
                        label={<><FaExclamationTriangle /> Update Failed - Retry</>}
                        onClick={handleCheckUpdate}
                        className="error-button"
                    />
                );
            default: // 'idle'
                return (
                    <Button
                        label={<><FaCheck /> App Up to Date</>}
                        onClick={handleCheckUpdate}
                        className="up-to-date"
                    />
                );
        }
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

    useEffect(() => {
        if (!isExpanded) return;

        refreshIpAddress();
        handleCheckUpdate();
        onCheckEffectsRepo();
        checkLocalChanges();
    }, [isExpanded]);

    useEffect(() => {
        const hasAppUpdate = autoUpdateState.status === 'available' || autoUpdateState.status === 'ready';
        setHasUpdates(effectsRepoStatus.hasUpdates || hasAppUpdate);
    }, [effectsRepoStatus.hasUpdates, autoUpdateState.status]);

    const handleWifiButtonClick = () => setShowWifiSettings(true);

    const handleWrapperClick = (e) => {
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

                    {/* Branch Selector - Disabled: all effects now on main branch */}

                    {renderAppUpdateButton()}
                    {/* Hidden but keeping code: {renderSyncButton()} */}

                    {/* Show local changes button when there are uncommitted changes */}
                    {hasLocalChanges && (
                        <Button
                            label={<><FaCodeBranch /> Local Changes</>}
                            onClick={() => setShowCommitPreview(true)}
                            className="local-changes-button"
                        />
                    )}
                    
                    <Button 
                        label={devMode ? "Disable Dev Mode" : "Enable Dev Mode"}
                        onClick={handleDevModeToggle}
                        className={devMode ? "dev-mode-on" : ""}
                    />
                    
                    {devMode && (
                        <>
                            <Button label={"Reload All Effects"} onClick={reloadEffectList} />
                            <Button label={"Reset Conversation"} onClick={resetClaudeConversation} />
                            <Button label={"Reboot Server"} onClick={rebootServer} />
                        </>
                    )}
                </div>
                
                {errorMessage && <div className="effect-management__error">{errorMessage}</div>}

                {ipAddress && (
                    <div className="effect-management__qr-code">
                        <QRCode 
                            value={`http://${ipAddress}:31337/remote/`}
                            size={80}
                            viewBox={`0 0 256 256`}
                        />
                        <p className="effect-management__qr-label">
                            {ipAddress}
                        </p>
                    </div>
                )}
                
                <div className="effect-management__info">
                    <p>Version: {version}</p>
                </div>
                
            </div>
            
            {showWifiSettings && ReactDOM.createPortal(
                <WifiSettings onClose={() => setShowWifiSettings(false)} />,
                document.body
            )}

            {showCommitPreview && ReactDOM.createPortal(
                <CommitPreview
                    onClose={() => setShowCommitPreview(false)}
                    onSuccess={() => {
                        setHasLocalChanges(false);
                        checkLocalChanges();
                    }}
                    onDiscard={() => {
                        setHasLocalChanges(false);
                        checkLocalChanges();
                        reloadEffectList();
                    }}
                />,
                document.body
            )}
            </div>
        </div>
    );
}

export default EffectManagement;

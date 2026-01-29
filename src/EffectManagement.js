import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { FaSync, FaCheck, FaExclamationTriangle, FaDownload, FaWifi, FaCodeBranch } from 'react-icons/fa';
import QRCode from 'react-qr-code';
import Button from './Button';
import ToggleButton from './ToggleButton';
import WifiSettings from './WifiSettings';
import CommitPreview from './CommitPreview';
import ipcProxy from './ipcProxy';
import './App.css';

const electron = window.electron;
const ipc = ipcProxy;

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
        // These are only available in Electron mode
        if (!electron) return;

        const handleIpAddressReply = (event, address) => {
            setIpAddress(address);
        };

        const handleVersionReply = (event, ver) => {
            setVersion(ver);
        };

        const unsub1 = ipc.on('ip-address-reply', handleIpAddressReply);
        const unsub2 = ipc.on('version-reply', handleVersionReply);

        ipc.send('get-ip-address');
        ipc.send('get-version');

        return () => {
            if (typeof unsub1 === 'function') unsub1();
            else ipc.removeListener('ip-address-reply', handleIpAddressReply);
            if (typeof unsub2 === 'function') unsub2();
            else ipc.removeListener('version-reply', handleVersionReply);
        };
    }, []);

    useEffect(() => {
        if (!electron) return;

        const timer = setTimeout(() => onCheckEffectsRepo(), 1500);
        return () => clearTimeout(timer);
    }, [onCheckEffectsRepo]);

    useEffect(() => {
        if (!electron) return;

        const handleAutoUpdateStatus = (event, data) => {
            const { status, version, percent, message } = data;
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

        const unsub = ipc.on('auto-update-status', handleAutoUpdateStatus);

        return () => {
            if (typeof unsub === 'function') unsub();
            else ipc.removeListener('auto-update-status', handleAutoUpdateStatus);
        };
    }, []);

    useEffect(() => {
        if (!electron) return;

        const handleWifiStatus = (event, status) => {
            setWifiStatus(status);
            ipc.send('get-ip-address');
        };

        const unsub = ipc.on('wifi-status', handleWifiStatus);
        ipc.send('check-wifi-status');

        return () => {
            if (typeof unsub === 'function') unsub();
            else ipc.removeListener('wifi-status', handleWifiStatus);
        };
    }, []);

    useEffect(() => {
        ipc.invoke('get-dev-mode').then(setDevMode).catch(() => setDevMode(false));

        const handleModeChange = (event, newMode) => {
            setDevMode(newMode);
        };

        const unsub = ipc.on('dev-mode-changed', handleModeChange);

        return () => {
            if (typeof unsub === 'function') unsub();
            else ipc.removeListener('dev-mode-changed', handleModeChange);
        };
    }, []);

    useEffect(() => {
        ipc.invoke('get-platform-info').then(info => {
            if (info?.isPi !== undefined) {
                setIsPlatformRaspberryPi(info.isPi);
            }
        }).catch(() => {});
    }, []);

    const refreshIpAddress = () => {
        if (electron) {
            ipc.send('get-ip-address');
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

            return new Promise((resolve) =>
            {
                ipc.send('get-audio-devices');
                ipc.once('audio-devices-reply', (event, devices) =>
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
        if (electron) ipc.send('reboot-server');
    };

    const resetClaudeConversation = () => {
        ipc.send('reset-claude-session');
    };

    const handleInputDeviceChange = (event) => {
        const selectedDevice = event.target.value;
        setSelectedInputDevice(selectedDevice);
        if (electron) {
            ipc.send('set-audio-devices', {
                inputDevice: selectedDevice,
                outputDevice: selectedOutputDevice
            });
        }
    };

    const handleOutputDeviceChange = (event) => {
        const selectedDevice = event.target.value;
        setSelectedOutputDevice(selectedDevice);
        if (electron) {
            ipc.send('set-audio-devices', {
                inputDevice: selectedInputDevice,
                outputDevice: selectedDevice
            });
        }
    };

    const refreshDevices = () => {
        fetchAudioDevices();
        refreshIpAddress();
    };

    const fetchGitBranches = () => {
        if (!electron) return;

        ipc.send('get-git-branches');
        ipc.once('git-branches-reply', (event, data) => {
            setAvailableBranches(data.branches);
            setCurrentBranch(data.currentBranch);
        });
        ipc.once('git-branches-error', (event, error) => {
            console.error('Failed to fetch branches:', error);
            setErrorMessage(`Failed to fetch branches: ${error}`);
        });
    };

    const checkLocalChanges = () => {
        if (!electron) return;

        ipc.send('check-git-local-changes');
        ipc.once('git-local-changes-reply', (event, data) => {
            setHasLocalChanges(data.hasLocalChanges);
        });
        ipc.once('git-local-changes-error', (event, error) => {
            console.error('Failed to check local changes:', error);
        });
    };

    const handleBranchChange = (newBranch) => {
        if (newBranch === currentBranch) return;

        setIsSwitchingBranch(true);
        ipc.send('switch-git-branch', newBranch);

        ipc.once('switch-branch-success', (event, data) => {
            setCurrentBranch(data.branch);
            setIsSwitchingBranch(false);
            reloadEffectList();
            checkLocalChanges();
        });

        ipc.once('switch-branch-error', (event, error) => {
            console.error('Failed to switch branch:', error);
            setErrorMessage(`Failed to switch branch: ${error}`);
            setIsSwitchingBranch(false);
        });
    };

    useEffect(() => {
        const hasConnectivity = !isPlatformRaspberryPi || wifiStatus.connected;
        if (!electron || !hasConnectivity) return;

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
        if (!electron) return;
        setAutoUpdateState(prev => ({ ...prev, status: 'checking' }));
        try {
            await ipc.invoke('check-for-updates');
        } catch (err) {
            setAutoUpdateState(prev => ({ ...prev, status: 'error', error: err.message }));
        }
    };

    const handleDownloadUpdate = async () => {
        if (!electron) return;
        try {
            await ipc.invoke('download-update');
        } catch (err) {
            setAutoUpdateState(prev => ({ ...prev, status: 'error', error: err.message }));
        }
    };

    const handleInstallUpdate = () => {
        if (!electron) return;
        ipc.invoke('install-update');
    };

    const handleQuit = () => {
        if (electron) ipc.send('quit-app');
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
        if (electron) {
            ipc.send('toggle-dev-mode');
            reloadEffectList();
        }
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
                            value={`http://${ipAddress}:31337/app/`}
                            size={80}
                            viewBox={`0 0 256 256`}
                        />
                        <p className="effect-management__qr-label">
                            {ipAddress} (Remote Control)
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

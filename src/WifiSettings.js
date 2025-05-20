import React, { useState, useEffect } from 'react';
import Keyboard from 'react-simple-keyboard';
import { FaCheck, FaExclamationTriangle, FaSync } from 'react-icons/fa';
import 'react-simple-keyboard/build/css/index.css';

function WifiSettings({ onClose }) {
    const [networks, setNetworks] = useState([]);
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [password, setPassword] = useState('');
    const [showKeyboard, setShowKeyboard] = useState(false);
    const [layoutName, setLayoutName] = useState("default");
    const [isConnected, setIsConnected] = useState(false);
    const [currentNetwork, setCurrentNetwork] = useState(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [connectionError, setConnectionError] = useState('');

    const keyboard = {
        layout: {
            default: [
                "1 2 3 4 5 6 7 8 9 0",
                "q w e r t y u i o p",
                "a s d f g h j k l",
                "{shift} {symbols} z x c v b n m {bksp}",
                "{space}"
            ],
            shift: [
                "! @ # $ % ^ & * ( )",
                "Q W E R T Y U I O P",
                "A S D F G H J K L",
                "{shift} {symbols} Z X C V B N M {bksp}",
                "{space}"
            ],
            symbols: [
                "! @ # $ % ^ & * ( )",
                "[ ] { } < > ~ ` |",
                "- = + _ \\ / ? :",
                "{abc} ; ' \" , . @ $ {bksp}",
                "{space}"
            ]
        },
        buttonTheme: [
            {
                class: "keyboard-button",
                buttons: "{shift} {symbols} {abc} {bksp}"
            }
        ]
    };

    useEffect(() => {
        console.log('WifiSettings mounted');
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.send('scan-wifi');
            
            // Store listener references
            const networksListener = (event, networks) => {
                console.log('Received networks:', networks);
                setNetworks(networks);
            };
            
            const statusListener = (event, status) => {
                setIsConnected(status.connected);
                setCurrentNetwork(status.ssid);
            };
            
            const connectionStatusListener = (event, status) => {
                console.log('Connection status:', status);
                if (status.status === 'waiting') {
                    setIsConnecting(true);
                } else {
                    setIsConnecting(false);
                    if (status.success) {
                        setIsConnected(true);
                        setCurrentNetwork(status.ssid);
                        setSelectedNetwork(null);
                        setPassword('');
                        setShowKeyboard(false);
                    } else {
                        setConnectionError(status.error);
                    }
                }
            };

            window.electron.ipcRenderer.on('wifi-networks', networksListener);
            window.electron.ipcRenderer.on('wifi-status', statusListener);
            window.electron.ipcRenderer.on('wifi-connection-status', connectionStatusListener);

            window.electron.ipcRenderer.send('check-wifi-status');

            return () => {
                if (window.electron && window.electron.ipcRenderer) {
                    window.electron.ipcRenderer.removeListener('wifi-networks', networksListener);
                    window.electron.ipcRenderer.removeListener('wifi-status', statusListener);
                    window.electron.ipcRenderer.removeListener('wifi-connection-status', connectionStatusListener);
                }
            };
        }
    }, []);

    const handleKeyboardInput = (input) => {
        console.log('Keyboard input:', input);
        setPassword(input);
    };

    const handleKeyPress = (button) => {
        switch (button) {
            case "{shift}":
                setLayoutName(layoutName === "default" ? "shift" : "default");
                break;
            case "{symbols}":
                setLayoutName("symbols");
                break;
            case "{abc}":
                setLayoutName("default");
                break;
            default:
                break;
        }
    };

    const handleNetworkSelect = (network) => {
        console.log('Network selected:', network);
        setSelectedNetwork(network);
        setShowKeyboard(true);
    };

    const handleConnect = () => {
        console.log('Connect attempted with:', {
            network: selectedNetwork,
            password: password
        });
        if (selectedNetwork && password) {
            setIsConnecting(true);
            window.electron.ipcRenderer.send('connect-wifi', { 
                ssid: selectedNetwork.ssid, 
                password 
            });
        }
    };

    const handleCancel = () => {
        setSelectedNetwork(null);
        setPassword('');
        setShowKeyboard(false);
    };

    return (
        <>
            <div className="wifi-settings-overlay" onClick={onClose}></div>
            <div className="wifi-settings-modal">
                <div className="wifi-header">
                    <div className="wifi-status">
                        {isConnected ? (
                            <div className="status-connected">
                                <FaCheck className="status-icon" />
                                <span>Connected to {currentNetwork}</span>
                            </div>
                        ) : isConnecting ? (
                            <div className="status-checking">
                                <FaSync className="spin status-icon" />
                                <span>Checking...</span>
                            </div>
                        ) : (
                            <div className="status-disconnected">
                                <FaExclamationTriangle className="status-icon" />
                                <span>Not Connected</span>
                            </div>
                        )}
                    </div>
                    {selectedNetwork && (
                        <h3>Connect to {selectedNetwork.ssid}</h3>
                    )}
                </div>
                {!selectedNetwork ? (
                    <ul>
                        {networks.map(network => (
                            <li key={network.ssid} onClick={() => handleNetworkSelect(network)}>
                                {network.ssid}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div>
                        {connectionError && (
                            <div className="error-message">
                                {connectionError}
                            </div>
                        )}
                        <input
                            type="text"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onFocus={() => setShowKeyboard(true)}
                            placeholder="Enter password"
                        />
                        <div className="wifi-settings-button-container">
                            <button 
                                onClick={handleConnect}
                                disabled={isConnecting}
                            >
                                {isConnecting ? 'Connecting...' : 'Connect'}
                            </button>
                            <button onClick={handleCancel}>Cancel</button>
                        </div>
                        {showKeyboard && (
                            <div className="keyboard-container" style={{ marginTop: '20px' }}>
                                <Keyboard
                                    keyboardRef={r => (keyboard.current = r)}
                                    layoutName={layoutName}
                                    layout={keyboard.layout}
                                    onChange={handleKeyboardInput}
                                    onKeyPress={handleKeyPress}
                                    buttonTheme={keyboard.buttonTheme}
                                    display={{
                                        '{bksp}': '⌫',
                                        '{shift}': '⇧',
                                        '{symbols}': '!@#',
                                        '{abc}': 'ABC',
                                        '{space}': ' '
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

export default WifiSettings; 
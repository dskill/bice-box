import React, { useState, useEffect } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

function WifiSettings({ onClose }) {
    const [networks, setNetworks] = useState([]);
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [password, setPassword] = useState('');
    const [showKeyboard, setShowKeyboard] = useState(false);
    const [layoutName, setLayoutName] = useState("default");

    useEffect(() => {
        console.log('WifiSettings mounted');
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.send('scan-wifi');
            window.electron.ipcRenderer.on('wifi-networks', (networks) => {
                console.log('Received networks:', networks);
                setNetworks(networks);
            });
        }
    }, []);

    const handleKeyboardInput = (input) => {
        console.log('Keyboard input:', input);
        setPassword(input);
    };

    const handleShift = () => {
        const newLayoutName = layoutName === "default" ? "shift" : "default";
        setLayoutName(newLayoutName);
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
                        <h3>Connect to {selectedNetwork.ssid}</h3>
                        <input
                            type="text"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onFocus={() => setShowKeyboard(true)}
                            placeholder="Enter password"
                        />
                        <div className="button-container">
                            <button onClick={handleConnect}>Connect</button>
                            <button onClick={handleCancel}>Cancel</button>
                        </div>
                        {showKeyboard && (
                            <div className="keyboard-container">
                                <Keyboard
                                    layoutName={layoutName}
                                    onChange={handleKeyboardInput}
                                    onKeyPress={(button) => {
                                        console.log('Button pressed:', button);
                                        if (button === "{shift}" || button === "{lock}") handleShift();
                                    }}
                                    layout={{
                                        default: [
                                            "1 2 3 4 5 6 7 8 9 0",
                                            "q w e r t y u i o p",
                                            "a s d f g h j k l",
                                            "{shift} z x c v b n m {bksp}",
                                            ".com @ {space}"
                                        ],
                                        shift: [
                                            "! @ # $ % ^ & * ( )",
                                            "Q W E R T Y U I O P",
                                            "A S D F G H J K L",
                                            "{shift} Z X C V B N M {bksp}",
                                            "{space}"
                                        ]
                                    }}
                                    display={{
                                        '{bksp}': '⌫',
                                        '{space}': ' ',
                                        '{shift}': '⇧'
                                    }}
                                    theme="hg-theme-default hg-layout-default myTheme"
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
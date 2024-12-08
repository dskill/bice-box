import React, { useState, useEffect } from 'react';
import './App.css';

function WifiSettings({ onClose }) {
    const [networks, setNetworks] = useState([]);
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [password, setPassword] = useState('');

    useEffect(() => {
        // Fetch available networks
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.send('scan-wifi');
            window.electron.ipcRenderer.on('wifi-networks', (networks) => {
                setNetworks(networks);
            });
        }
    }, []);

    const handleNetworkSelect = (network) => {
        setSelectedNetwork(network);
    };

    const handleConnect = () => {
        if (selectedNetwork && password) {
            window.electron.ipcRenderer.send('connect-wifi', { ssid: selectedNetwork.ssid, password });
        }
    };

    return (
        <>
            <div className="wifi-settings-overlay" onClick={onClose}></div>
            <div className="wifi-settings-modal">
                <h2>Available Networks</h2>
                <ul>
                    {networks.map(network => (
                        <li key={network.ssid} onClick={() => handleNetworkSelect(network)}>
                            {network.ssid}
                        </li>
                    ))}
                </ul>
                {selectedNetwork && (
                    <div>
                        <h3>Connect to {selectedNetwork.ssid}</h3>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                        />
                        <button onClick={handleConnect}>Connect</button>
                    </div>
                )}
                <button onClick={onClose}>Close</button>
            </div>
        </>
    );
}

export default WifiSettings; 
import React from 'react';
import { FaDownload } from 'react-icons/fa';
import './ToggleButton.css';

function ToggleButton({ isOn, setIsOn, onText, offText, hasUpdates }) {
    return (
        <button 
            className={`toggle-button ${isOn ? 'on' : 'off'} ${hasUpdates ? 'has-updates' : ''}`} 
            onClick={() => setIsOn(!isOn)}
        >
            {hasUpdates && !isOn && <FaDownload className="update-indicator" />}
            {isOn ? onText : offText}
        </button>
    );
}

export default ToggleButton;

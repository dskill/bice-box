import React from 'react';
import './ToggleButton.css';

function ToggleButton({ isOn, setIsOn, onText, offText }) {
    const onClick = () => {
        setIsOn(prev => !prev);
    }

    return (
        <div className="toggle-button">
            <button className={`toggle-text ${isOn ? 'on' : 'off'}`} onClick={onClick}>
                {isOn ? onText : offText}
            </button>
        </div>
    );
}

export default ToggleButton;

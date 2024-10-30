import {
    NONE,
    IDLE,
    RECORDING,
    PROCESSING_STT,
    PROCESSING_GPT_RESPONSE,
    PROCESSING_TTS,
    SPEAKING,
    globalState,
} from './globalState';
import React, { useState } from 'react';

function EditableText({ state, transition, text, setText }) {
    const [isEditing, setIsEditing] = useState(false);

    const handleTextClick = () => {
        setIsEditing(true);
    };

    const handleInputChange = (e) => {
        setText(e.target.value);
    };

    const handleInputBlur = () => {
        setIsEditing(false);
      //  transition(PROCESSING_GPT_RESPONSE);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            setIsEditing(false);
            transition(PROCESSING_GPT_RESPONSE);
        }
    };

    return isEditing ? (
        <input
            type="text"
            value={text}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyPress={handleKeyPress}
            autoFocus
        />
    ) : (

        <p className="whisper-text" onClick={handleTextClick}>
            <span className="understated-text">You:</span> {text}
        </p>
    );
}

export default EditableText;
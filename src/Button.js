import React, { useState } from 'react';
import './ToggleButton.css'; // Make sure this path matches the location of your CSS file

function Button({ label, onClick }) {

  return (
      <button className={`button`} onClick={onClick}>
        {label}
      </button>
  );
}

export default Button;

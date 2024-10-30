// SnapshotPreview.js
import React from 'react';
import './App.css'; // Import the CSS for styling

const SnapshotPreview = ({ image, onDelete }) => {
  return (
    <div className="snapshot-preview">
      <button className="close-button" onClick={onDelete}>X</button>
      <img src={image} alt="Captured" />
    </div>
  ); 
};

export default SnapshotPreview;

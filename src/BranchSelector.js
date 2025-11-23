import React from 'react';
import { FaCodeBranch, FaCheck, FaSync } from 'react-icons/fa';
import './App.css'; // Ensure we have access to the styles

function BranchSelector({ branches, currentBranch, onSelectBranch, onClose, isSwitching }) {
    return (
        <>
            <div className="wifi-settings-overlay" onClick={onClose}></div>
            <div className="wifi-settings-modal">
                <div className="wifi-header">
                    <div className="wifi-status">
                        <div className="status-connected">
                            <FaCodeBranch className="status-icon" />
                            <span>Current Branch: {currentBranch}</span>
                        </div>
                    </div>
                    <h3>Select Branch</h3>
                </div>

                {isSwitching ? (
                    <div className="status-checking" style={{ padding: '20px', textAlign: 'center' }}>
                        <FaSync className="spin status-icon" style={{ fontSize: '24px', marginBottom: '10px' }} />
                        <div>Switching branch...</div>
                    </div>
                ) : (
                    <ul>
                        {branches.map(branch => (
                            <li 
                                key={branch} 
                                onClick={() => onSelectBranch(branch)}
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    backgroundColor: branch === currentBranch ? 'rgba(34, 197, 94, 0.1)' : undefined
                                }}
                            >
                                <span>{branch}</span>
                                {branch === currentBranch && <FaCheck style={{ color: '#22c55e' }} />}
                            </li>
                        ))}
                    </ul>
                )}

                <div className="wifi-settings-button-container">
                    <button onClick={onClose} disabled={isSwitching}>Close</button>
                </div>
            </div>
        </>
    );
}

export default BranchSelector;


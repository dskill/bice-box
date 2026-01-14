import React, { useState, useEffect, useRef } from 'react';
import { FaSync, FaCheck, FaExclamationTriangle, FaCodeBranch, FaTrash } from 'react-icons/fa';
import './App.css';

const electron = window.electron;

function CommitPreview({ onClose, onSuccess, onDiscard }) {
    const [changedFiles, setChangedFiles] = useState([]);
    const [commitMessage, setCommitMessage] = useState('');
    const [isLoadingDiff, setIsLoadingDiff] = useState(true);
    const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDiscarding, setIsDiscarding] = useState(false);
    const [error, setError] = useState('');

    // Use refs to access callbacks without re-running effect
    const onCloseRef = useRef(onClose);
    const onSuccessRef = useRef(onSuccess);
    const onDiscardRef = useRef(onDiscard);
    onCloseRef.current = onClose;
    onSuccessRef.current = onSuccess;
    onDiscardRef.current = onDiscard;

    // Guard against React StrictMode double-mounting
    const hasRequestedDiff = useRef(false);
    const hasReceivedDiff = useRef(false);
    const hasRequestedMessage = useRef(false);

    useEffect(() => {
        if (!electron || !electron.ipcRenderer) {
            setError('Electron not available');
            setIsLoadingDiff(false);
            return;
        }

        const generateCommitMessageFromDiff = (diffContent, files) => {
            if (hasRequestedMessage.current) return;
            hasRequestedMessage.current = true;
            setIsGeneratingMessage(true);
            const filesSummary = files.join('\n');
            const content = `Files changed:\n${filesSummary}\n\nDiff:\n${diffContent.slice(0, 4000)}`;
            electron.ipcRenderer.send('generate-commit-message', content);
        };

        const handleDiffReply = (event, data) => {
            if (hasReceivedDiff.current) return;
            hasReceivedDiff.current = true;
            setIsLoadingDiff(false);
            if (data.success) {
                setChangedFiles(data.changedFiles);
                generateCommitMessageFromDiff(data.diff, data.changedFiles);
            } else {
                setError(data.error || 'Failed to get diff');
            }
        };

        const handleCommitMessageReply = (event, data) => {
            setIsGeneratingMessage(false);
            if (data.success) {
                setCommitMessage(data.message);
            } else {
                setCommitMessage(data.fallbackMessage || 'Update effects');
                if (data.error) {
                    console.warn('Commit message generation failed:', data.error);
                }
            }
        };

        const handleCommitPushReply = (event, data) => {
            setIsCommitting(false);
            if (data.success) {
                onSuccessRef.current();
                onCloseRef.current();
            } else {
                setError(data.error || 'Failed to commit and push');
            }
        };

        electron.ipcRenderer.on('git-diff-reply', handleDiffReply);
        electron.ipcRenderer.on('commit-message-reply', handleCommitMessageReply);
        electron.ipcRenderer.on('git-commit-push-reply', handleCommitPushReply);

        if (!hasRequestedDiff.current) {
            hasRequestedDiff.current = true;
            electron.ipcRenderer.send('get-git-diff');
        }

        return () => {
            electron.ipcRenderer.removeListener('git-diff-reply', handleDiffReply);
            electron.ipcRenderer.removeListener('commit-message-reply', handleCommitMessageReply);
            electron.ipcRenderer.removeListener('git-commit-push-reply', handleCommitPushReply);
        };
    }, []);

    const handleCommit = () => {
        if (!commitMessage.trim()) {
            setError('Commit message cannot be empty');
            return;
        }

        setIsCommitting(true);
        setError('');
        electron.ipcRenderer.send('git-commit-and-push', commitMessage.trim());
    };

    const handleDiscard = () => {
        if (!window.confirm('Are you sure you want to discard all local changes? This cannot be undone.')) {
            return;
        }

        setIsDiscarding(true);
        setError('');

        electron.ipcRenderer.send('discard-git-changes');

        electron.ipcRenderer.once('discard-changes-success', () => {
            setIsDiscarding(false);
            if (onDiscardRef.current) onDiscardRef.current();
            onCloseRef.current();
        });

        electron.ipcRenderer.once('discard-changes-error', (event, err) => {
            setIsDiscarding(false);
            setError(`Failed to discard changes: ${err}`);
        });
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && !isCommitting && !isDiscarding) {
                onCloseRef.current();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isCommitting, isDiscarding]);

    const isLoading = isLoadingDiff || isGeneratingMessage;
    const isBusy = isCommitting || isDiscarding;
    const canCommit = !isLoading && !isBusy && commitMessage.trim() && changedFiles.length > 0;
    const canDiscard = !isLoadingDiff && !isBusy && changedFiles.length > 0;

    return (
        <>
            <div className="wifi-settings-overlay" onClick={isBusy ? undefined : onClose}></div>
            <div className="wifi-settings-modal commit-preview-modal">
                <div className="wifi-header">
                    <div className="wifi-status">
                        <div className="status-connected">
                            <FaCodeBranch className="status-icon" />
                            <span>Local Changes</span>
                        </div>
                    </div>
                </div>

                {isLoadingDiff ? (
                    <div className="commit-loading">
                        <FaSync className="spin" />
                        <span>Loading changes...</span>
                    </div>
                ) : (
                    <>
                        <div className="commit-section">
                            <h4>Changed Files ({changedFiles.length})</h4>
                            <div className="commit-files-list">
                                {changedFiles.map((file, index) => (
                                    <div key={index} className="commit-file-item">
                                        {file}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="commit-section">
                            <h4>
                                Commit Message
                                {isGeneratingMessage && (
                                    <span className="generating-label">
                                        <FaSync className="spin" /> Generating...
                                    </span>
                                )}
                            </h4>
                            <textarea
                                className="commit-message-input"
                                value={commitMessage}
                                onChange={(e) => setCommitMessage(e.target.value)}
                                placeholder={isGeneratingMessage ? 'Generating commit message...' : 'Enter commit message'}
                                disabled={isGeneratingMessage || isCommitting}
                                rows={3}
                            />
                        </div>

                        {error && (
                            <div className="commit-error">
                                <FaExclamationTriangle /> {error}
                            </div>
                        )}
                    </>
                )}

                <div className="wifi-settings-button-container local-changes-buttons">
                    <button
                        onClick={onClose}
                        disabled={isBusy}
                        className="commit-cancel-btn"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDiscard}
                        disabled={!canDiscard}
                        className="commit-discard-btn"
                    >
                        {isDiscarding ? (
                            <><FaSync className="spin" /> Discarding...</>
                        ) : (
                            <><FaTrash /> Discard</>
                        )}
                    </button>
                    <button
                        onClick={handleCommit}
                        disabled={!canCommit}
                        className="commit-confirm-btn"
                    >
                        {isCommitting ? (
                            <><FaSync className="spin" /> Pushing...</>
                        ) : (
                            <><FaCheck /> Commit & Push</>
                        )}
                    </button>
                </div>
            </div>
        </>
    );
}

export default CommitPreview;

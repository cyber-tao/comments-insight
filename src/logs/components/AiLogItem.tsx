import React, { useState } from 'react';
import { AiLogEntry } from '../hooks/useLogs';
import { Logger } from '@/utils/logger';

interface AiLogItemProps {
  log: AiLogEntry;
  onDelete: (key: string, e: React.MouseEvent) => void;
}

export const AiLogItem: React.FC<AiLogItemProps> = ({ log, onDelete }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      Logger.error('[Logs] Failed to copy', { error });
    }
  };

  const formattedTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(log.timestamp);

  return (
    <div className="log-item-wrapper">
      <button
        className="log-item ai-log w-full text-left border-none bg-transparent"
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsExpanded(!isExpanded);
            e.preventDefault();
          }
        }}
        aria-expanded={isExpanded}
      >
        <div className="log-header">
          <span className="log-type">
            {log.type === 'extraction' ? '📥 AI Extraction' : '📊 AI Analysis'}
          </span>
          <span className="log-time">{formattedTime}</span>
        </div>
        <div className="log-stats">
          Prompt: {log.prompt?.length || 0} chars | Response: {log.response?.length || 0} chars
        </div>
      </button>

      {isExpanded && (
        <div className="log-detail-inline">
          <div className="log-detail">
            <h2>{log.type === 'extraction' ? '📥 AI Extraction Log' : '📊 AI Analysis Log'}</h2>
            <p>
              <strong>Time:</strong> {formattedTime}
            </p>

            <div className="log-section">
              <h3>Prompt ({log.prompt?.length || 0} characters)</h3>
              <div className="log-content">{log.prompt || 'No prompt'}</div>
            </div>

            <div className="log-section">
              <h3>Response ({log.response?.length || 0} characters)</h3>
              <div className="log-content">{log.response || 'No response'}</div>
            </div>

            <div className="log-actions">
              <button className="btn-secondary" onClick={(e) => copyToClipboard(log.prompt, e)}>
                📋 Copy Prompt
              </button>
              <button className="btn-secondary" onClick={(e) => copyToClipboard(log.response, e)}>
                📋 Copy Response
              </button>
              <button className="btn-danger" onClick={(e) => onDelete(log.key, e)}>
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

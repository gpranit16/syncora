import React from 'react';
import { X } from 'lucide-react';
import './PinnedMessagesPanel.css';

interface PinnedMessageItem {
  id: number;
  sender_name: string;
  message_text: string;
}

interface PinnedMessagesPanelProps {
  title: string;
  pinned: PinnedMessageItem[];
  onSelect: (id: number) => void;
  onClose: () => void;
}

/**
 * Lightweight "Pinned messages" popup for the current conversation.
 * Clicking a row jumps/scrolls to that message (handled by the caller).
 */
const PinnedMessagesPanel: React.FC<PinnedMessagesPanelProps> = ({
  title,
  pinned,
  onSelect,
  onClose,
}) => (
  <>
    <div className="pinned-overlay" onClick={onClose} />
    <div className="pinned-panel">
      <div className="pinned-header">
        <h3>{'\u{1F4CC}'} {title}</h3>
        <button className="btn-icon" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="pinned-list">
        {pinned.map((item) => (
          <button key={item.id} type="button" className="pinned-row" onClick={() => onSelect(item.id)}>
            <span className="pinned-row-sender">{item.sender_name}</span>
            <span className="pinned-row-text">{item.message_text || '(file)'}</span>
          </button>
        ))}
        {pinned.length === 0 && <div className="pinned-empty">No pinned messages in this conversation.</div>}
      </div>
    </div>
  </>
);

export default PinnedMessagesPanel;
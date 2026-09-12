import React, { useRef, useState } from 'react';
import { SmilePlus, Send } from 'lucide-react';
import { ALLOWED_REACTIONS, MAX_REACTION_LENGTH, isValidReactionEmoji, type ReactionSummary } from '../../utils/reactions';
import { useClickOutside } from '../../hooks/useSocket';
import './MessageReactions.css';

interface MessageReactionsProps {
  reactions?: ReactionSummary[];
  myReactions?: string[];
  isDeleted?: boolean;
  onToggle: (emoji: string) => void;
}

/**
 * WhatsApp-style reaction bar shared by ChatView (channels) and DmView (DMs):
 * - reaction chips with counts below the message, own reactions highlighted
 * - clicking a chip toggles the reaction (re-click removes it)
 * - hover reveals a smiley button that opens the emoji picker
 */
const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions = [],
  myReactions = [],
  isDeleted = false,
  onToggle,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openDown, setOpenDown] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);

  useClickOutside(anchorRef, () => setPickerOpen(false));

  if (isDeleted) {
    return null;
  }

  const togglePicker = () => {
    setPickerOpen((open) => {
      const next = !open;
      if (next && anchorRef.current) {
        const container = anchorRef.current.closest('.chat-messages');
        if (container) {
          const anchorRect = anchorRef.current.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          // Not enough room above the message? Open the picker downwards.
          setOpenDown(anchorRect.top - containerRect.top < 170);
        }
      }
      return next;
    });
  };

  const handleToggle = (emoji: string) => {
    setPickerOpen(false);
    onToggle(emoji);
  };

  const submitCustom = () => {
    const emoji = customInput.trim();
    if (emoji && isValidReactionEmoji(emoji)) {
      handleToggle(emoji);
      setCustomInput('');
    }
  };

  return (
    <div className="reaction-bar">
      {reactions.map((reaction) => {
        const mine = myReactions.includes(reaction.emoji);
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={`reaction-chip ${mine ? 'reaction-chip-mine' : ''}`}
            title={mine ? 'Remove your reaction' : 'React with this emoji'}
            onClick={() => handleToggle(reaction.emoji)}
          >
            <span className="reaction-emoji">{reaction.emoji}</span>
            {reaction.count > 1 && <span className="reaction-count">{reaction.count}</span>}
          </button>
        );
      })}
      <div className="reaction-add-anchor" ref={anchorRef}>
        <button
          type="button"
          className={`reaction-add-btn ${pickerOpen ? 'visible' : ''}`}
          title="Add reaction"
          onClick={togglePicker}
        >
          <SmilePlus size={14} />
        </button>
        {pickerOpen && (
          <div className={`reaction-picker ${openDown ? 'reaction-picker-open-down' : ''}`}>
            {ALLOWED_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="reaction-picker-btn"
                title={emoji}
                onClick={() => handleToggle(emoji)}
              >
                {emoji}
              </button>
            ))}
            <span className="reaction-picker-divider" />
            <input
              className="reaction-picker-input"
              value={customInput}
              placeholder="Any emoji…"
              maxLength={MAX_REACTION_LENGTH}
              onChange={(e) => setCustomInput(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCustom();
                if (e.key === 'Escape') setPickerOpen(false);
              }}
            />
            <button
              type="button"
              className="reaction-picker-send"
              title="Send custom emoji"
              disabled={!customInput.trim()}
              onClick={submitCustom}
            >
              <Send size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageReactions;

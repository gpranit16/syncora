import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Sparkles, AlertCircle, Loader2, GripHorizontal, Minimize2 } from 'lucide-react';
import { askAI } from '../../api/ai';
import FormattedAIMessage from '../FormattedAIMessage/FormattedAIMessage';
import './AIAssistantPanel.css';

interface AIAssistantPanelProps {
  contextType: 'channel' | 'dm';
  contextId?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
}

// Ultra-polished futuristic AI Robot icon
const SleekRobotIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="robotBodyGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c084fc" />
        <stop offset="50%" stopColor="#818cf8" />
        <stop offset="100%" stopColor="#38bdf8" />
      </linearGradient>
      <linearGradient id="robotVisorGrad" x1="6" y1="10" x2="18" y2="10" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#818cf8" />
      </linearGradient>
    </defs>
    {/* Outer chassis */}
    <rect x="3.5" y="5.5" width="17" height="14" rx="4.5" stroke="url(#robotBodyGrad)" strokeWidth="1.8" fill="rgba(139, 92, 246, 0.14)" />
    {/* Glowing visor */}
    <path d="M7 11.5C7 10.12 8.12 9 9.5 9H14.5C15.88 9 17 10.12 17 11.5C17 12.88 15.88 14 14.5 14H9.5C8.12 14 7 12.88 7 11.5Z" fill="url(#robotVisorGrad)" />
    {/* Cyber optical nodes */}
    <circle cx="10" cy="11.5" r="1.3" fill="#ffffff" />
    <circle cx="14" cy="11.5" r="1.3" fill="#ffffff" />
    {/* Antenna node */}
    <path d="M12 2.5V5.5" stroke="url(#robotBodyGrad)" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="2.5" r="1.2" fill="#38bdf8" />
    {/* Side ear ports */}
    <path d="M2 11.5H3.5M20.5 11.5H22" stroke="url(#robotBodyGrad)" strokeWidth="1.8" strokeLinecap="round" />
    {/* Chin detail */}
    <path d="M10 16.5H14" stroke="url(#robotBodyGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
  </svg>
);

const SUGGESTIONS = [
  'Summarize this conversation',
  'What tasks are pending?',
  'What were the key decisions?',
  'List any blockers discussed',
];

const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({ contextType, contextId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Dragging state for AI Assistant Window
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Dragging state for AI FAB Trigger Button
  const [fabPosition, setFabPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = localStorage.getItem('syncora_ai_fab_pos');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const fabRef = useRef<HTMLButtonElement>(null);
  const isFabDraggingRef = useRef(false);
  const fabDragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number; hasMoved: boolean }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFabMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isFabDraggingRef.current = true;
    fabDragStartRef.current.hasMoved = false;

    const fabEl = fabRef.current;
    const rect = fabEl
      ? fabEl.getBoundingClientRect()
      : { left: window.innerWidth - 100, top: window.innerHeight - 120 };

    fabDragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: fabPosition ? fabPosition.x : rect.left,
      initialY: fabPosition ? fabPosition.y : rect.top,
      hasMoved: false,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isFabDraggingRef.current) return;
      const deltaX = moveEvent.clientX - fabDragStartRef.current.startX;
      const deltaY = moveEvent.clientY - fabDragStartRef.current.startY;
      if (Math.hypot(deltaX, deltaY) > 4) {
        fabDragStartRef.current.hasMoved = true;
      }
      const newX = Math.max(10, Math.min(window.innerWidth - 80, fabDragStartRef.current.initialX + deltaX));
      const newY = Math.max(10, Math.min(window.innerHeight - 60, fabDragStartRef.current.initialY + deltaY));
      const nextPos = { x: newX, y: newY };
      setFabPosition(nextPos);
      try {
        localStorage.setItem('syncora_ai_fab_pos', JSON.stringify(nextPos));
      } catch {}
    };

    const handleMouseUp = () => {
      isFabDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (!fabDragStartRef.current.hasMoved) {
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDraggingRef.current = true;

    const panelEl = panelRef.current;
    const rect = panelEl
      ? panelEl.getBoundingClientRect()
      : { left: window.innerWidth - 400, top: window.innerHeight - 560 };

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position ? position.x : rect.left,
      initialY: position ? position.y : rect.top,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = moveEvent.clientX - dragStartRef.current.startX;
      const deltaY = moveEvent.clientY - dragStartRef.current.startY;
      const newX = Math.max(10, Math.min(window.innerWidth - 390, dragStartRef.current.initialX + deltaX));
      const newY = Math.max(10, Math.min(window.innerHeight - 150, dragStartRef.current.initialY + deltaY));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleAsk = async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: question.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const { data } = await askAI({
        question: question.trim(),
        context_type: contextType,
        context_id: contextId,
      });

      if (data.success && data.answer) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.answer! }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message || 'Unable to get a response.', isError: true },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'AI service is temporarily unavailable. Please try again.', isError: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Sleek Moveable Floating AI Assistant Button */}
      <button
        ref={fabRef}
        className="ai-assistant-fab"
        onMouseDown={handleFabMouseDown}
        style={
          fabPosition
            ? { left: `${fabPosition.x}px`, top: `${fabPosition.y}px`, bottom: 'auto', right: 'auto' }
            : undefined
        }
        title="Syncora AI Assistant (Drag to move)"
      >
        <div className="ai-fab-icon-wrap">
          <SleekRobotIcon size={18} className="ai-fab-icon" />
        </div>
        <span className="ai-fab-label">AI</span>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="ai-assistant-panel"
          style={
            position
              ? { left: `${position.x}px`, top: `${position.y}px`, bottom: 'auto', right: 'auto' }
              : undefined
          }
        >
          {/* Draggable Header */}
          <div className="ai-assistant-header" onMouseDown={handleHeaderMouseDown}>
            <div className="ai-assistant-title">
              <GripHorizontal size={14} className="ai-drag-handle" />
              <SleekRobotIcon size={16} />
              <span>Syncora AI</span>
            </div>
            <div className="ai-header-controls">
              <button
                className="ai-assistant-btn-icon"
                onClick={() => setIsOpen(false)}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="ai-assistant-messages">
            {messages.length === 0 && (
              <div className="ai-assistant-empty">
                <div className="ai-empty-icon-wrap">
                  <SleekRobotIcon size={24} />
                </div>
                <h4>How can I help?</h4>
                <p>Ask anything about this {contextType === 'channel' ? 'channel' : 'conversation'}.</p>
                <div className="ai-assistant-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => handleAsk(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`ai-msg ${msg.role} ${msg.isError ? 'error' : ''}`}>
                {msg.isError && <AlertCircle size={14} className="ai-msg-error-icon" />}
                <div className="ai-msg-content">
                  {msg.role === 'assistant' ? (
                    <FormattedAIMessage content={msg.content} />
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="ai-msg assistant loading">
                <Loader2 size={14} className="spin" />
                <span>Analyzing context...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="ai-assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about this channel..."
              disabled={isLoading}
            />
            <button type="submit" disabled={!input.trim() || isLoading}>
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default AIAssistantPanel;
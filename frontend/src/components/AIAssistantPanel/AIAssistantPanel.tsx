import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { askAI, type AskAIResponse } from '../../api/ai';
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

const SUGGESTIONS = [
  'Summarize this conversation',
  'What is pending?',
  'What are the blockers?',
  'What did we decide?',
];

const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({ contextType, contextId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAsk = async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: question.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const { data } = await askAI({
        question: question.trim(),
        context_type: contextType,
        context_id: contextId,
      });

      if (data.success && data.answer) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer! }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message || 'Unable to get a response.', isError: true }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'AI service is temporarily unavailable. Please try again.', isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        className="ai-assistant-fab"
        onClick={() => setIsOpen(!isOpen)}
        title="AI Assistant"
      >
        <Bot size={22} />
      </button>

      {isOpen && (
        <div className="ai-assistant-panel">
          <div className="ai-assistant-header">
            <div className="ai-assistant-title">
              <Sparkles size={18} />
              <span>AI Assistant</span>
            </div>
            <button className="ai-assistant-close" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="ai-assistant-messages">
            {messages.length === 0 && (
              <div className="ai-assistant-empty">
                <Sparkles size={32} />
                <p>Ask me anything about this {contextType === 'channel' ? 'channel' : 'conversation'}</p>
                <div className="ai-assistant-suggestions">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => handleAsk(s)}>{s}</button>
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
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="ai-msg assistant loading">
                <Loader2 size={14} className="spin" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="ai-assistant-input"
            onSubmit={e => {
              e.preventDefault();
              handleAsk(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={isLoading}
            />
            <button type="submit" disabled={!input.trim() || isLoading}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default AIAssistantPanel;
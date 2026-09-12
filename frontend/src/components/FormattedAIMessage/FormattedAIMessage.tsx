import React from 'react';
import './FormattedAIMessage.css';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

interface FormattedAIMessageProps {
  content: string;
}

export const FormattedAIMessage: React.FC<FormattedAIMessageProps> = ({ content }) => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    const isOrdered = currentList.type === 'ol';
    const listElements = (
      <div key={`list-${elements.length}`} className="ai-formatted-list">
        {currentList.items.map((item, idx) => (
          <div key={idx} className="ai-list-item">
            <span className="ai-list-bullet">{isOrdered ? `${idx + 1}.` : '•'}</span>
            <div className="ai-list-content">{renderInline(item)}</div>
          </div>
        ))}
      </div>
    );
    elements.push(listElements);
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      flushList();
      continue;
    }

    // Check for bullet list: "- ", "* ", "• "
    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Check for numbered list: "1. ", "2. ", etc.
    const numMatch = line.match(/^\d+\.\s+(.*)$/);
    if (numMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numMatch[1]);
      continue;
    }

    flushList();

    // Check for heading: "### Heading"
    const headingMatch = line.match(/^#{1,3}\s+(.*)$/);
    if (headingMatch) {
      elements.push(
        <h4 key={`h-${elements.length}`} className="ai-formatted-heading">
          {renderInline(headingMatch[1])}
        </h4>
      );
      continue;
    }

    // Standard paragraph
    elements.push(
      <p key={`p-${elements.length}`} className="ai-formatted-para">
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  return <div className="ai-formatted-message">{elements}</div>;
};

// Inline token renderer for bold, code, task IDs, statuses, priorities
function renderInline(text: string): React.ReactNode {
  const tokenRegex = /(\*\*#\d+\*\*|#\d+|\*\*[^*]+\*\*|`[^`]+`|\b(?:pending|in_progress|in progress|completed)\b|\b(?:high|medium|low)\s+priority\b)/gi;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // Task ID with bold: **#123** or #123
    const idMatch = part.match(/^\*\*?(#\d+)\*\*?$/);
    if (idMatch) {
      return (
        <span key={idx} className="ai-token-task-id">
          {idMatch[1]}
        </span>
      );
    }

    // Code chip: `title`
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeContent = part.slice(1, -1);
      return (
        <span key={idx} className="ai-token-code">
          {codeContent}
        </span>
      );
    }

    // Bold text: **text**
    if (part.startsWith('**') && part.endsWith('**')) {
      const boldContent = part.slice(2, -2);
      return (
        <strong key={idx} className="ai-token-bold">
          {boldContent}
        </strong>
      );
    }

    // Status badge
    const lower = part.toLowerCase().replace('_', ' ');
    if (lower === 'pending') {
      return (
        <span key={idx} className="ai-status-badge status-pending">
          <Clock size={10} /> pending
        </span>
      );
    }
    if (lower === 'in progress') {
      return (
        <span key={idx} className="ai-status-badge status-progress">
          in progress
        </span>
      );
    }
    if (lower === 'completed') {
      return (
        <span key={idx} className="ai-status-badge status-completed">
          <CheckCircle2 size={10} /> completed
        </span>
      );
    }

    // Priority badge
    if (lower.includes('high priority')) {
      return (
        <span key={idx} className="ai-priority-badge priority-high">
          <AlertTriangle size={10} /> high priority
        </span>
      );
    }
    if (lower.includes('medium priority')) {
      return (
        <span key={idx} className="ai-priority-badge priority-medium">
          medium priority
        </span>
      );
    }
    if (lower.includes('low priority')) {
      return (
        <span key={idx} className="ai-priority-badge priority-low">
          low priority
        </span>
      );
    }

    return part;
  });
}

export default FormattedAIMessage;

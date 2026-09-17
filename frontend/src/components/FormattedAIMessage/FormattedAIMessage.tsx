import React from 'react';
import './FormattedAIMessage.css';
import { CheckCircle2, Clock, AlertTriangle, CheckSquare, ListOrdered, Sparkles, FileText } from 'lucide-react';

interface FormattedAIMessageProps {
  content: string;
}

export const FormattedAIMessage: React.FC<FormattedAIMessageProps> = ({ content }) => {
  if (!content) return null;

  // 1. Check if the content is JSON or wrapped in a json codeblock
  const parsedJson = tryExtractJson(content);
  if (parsedJson) {
    return <StructuredJsonView data={parsedJson} />;
  }

  // 2. Otherwise, parse as enhanced markdown / text
  const rawLines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let currentTable: string[][] | null = null;

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

  const flushTable = () => {
    if (!currentTable || currentTable.length === 0) return;
    const headers = currentTable[0];
    const rows = currentTable.slice(1);
    elements.push(
      <div key={`tbl-${elements.length}`} className="ai-table-wrapper">
        <table className="ai-table">
          <thead>
            <tr>
              {headers.map((h, idx) => (
                <th key={idx}>{renderInline(h.trim())}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>{renderInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    currentTable = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const line = rawLine.trim();

    if (!line) {
      flushList();
      flushTable();
      continue;
    }

    // Ignore raw json delimiters if any leaked
    if (line === '{' || line === '}' || line === '```json' || line === '```') {
      continue;
    }

    // Ignore conversational closing filler
    if (/^(?:Let me know if you(?:'d| would)? like|Please let me know if you (?:have|need)|Hope this helps!|Feel free to ask)/i.test(line)) {
      continue;
    }

    // Markdown Table Row: | cell1 | cell2 |
    if (line.startsWith('|') && line.endsWith('|')) {
      // Ignore separator row like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        continue;
      }
      flushList();
      const cells = line.slice(1, -1).split('|');
      if (!currentTable) {
        currentTable = [];
      }
      currentTable.push(cells);
      continue;
    }

    flushTable();

    // Bullet list: "- ", "* ", "• "
    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Numbered list: "1. ", "2. ", etc.
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

    // Headings: "### Heading" or "**Heading:**"
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
  flushTable();

  return <div className="ai-formatted-message">{elements}</div>;
};

/**
 * Try to extract valid JSON from direct string or json codeblock
 */
function tryExtractJson(text: string): Record<string, any> | null {
  const trimmed = text.trim();

  // Try direct parse
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  // Try extracting from ```json ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }

  // Try substring between first { and last }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const sub = trimmed.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(sub);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {}
  }

  return null;
}

/**
 * Clean structured UI for parsed JSON responses
 */
const StructuredJsonView: React.FC<{ data: Record<string, any> }> = ({ data }) => {
  const summary = data.summary || data.answer || data.overview || data.response;
  const keyPoints = data.key_points || data.points || data.highlights || data.decisions;
  const actionItems = data.action_items || data.tasks || data.next_steps;
  const blockers = data.blockers || data.issues;

  return (
    <div className="ai-structured-view">
      {summary && (
        <div className="ai-json-summary-card">
          <div className="ai-json-section-header">
            <Sparkles size={13} className="ai-json-icon" />
            <span>Summary</span>
          </div>
          <p className="ai-json-summary-text">{summary}</p>
        </div>
      )}

      {Array.isArray(keyPoints) && keyPoints.length > 0 && (
        <div className="ai-json-section">
          <div className="ai-json-section-header">
            <ListOrdered size={13} className="ai-json-icon" />
            <span>Key Points & Decisions</span>
          </div>
          <div className="ai-json-list">
            {keyPoints.map((pt: any, i: number) => (
              <div key={i} className="ai-json-list-item">
                <span className="ai-json-bullet">•</span>
                <span>{typeof pt === 'string' ? pt : pt.text || pt.title || JSON.stringify(pt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(actionItems) && actionItems.length > 0 && (
        <div className="ai-json-section">
          <div className="ai-json-section-header">
            <CheckSquare size={13} className="ai-json-icon" />
            <span>Action Items</span>
          </div>
          <div className="ai-json-tasks">
            {actionItems.map((item: any, i: number) => {
              const itemText = typeof item === 'string' ? item : item.task || item.title || item.description || JSON.stringify(item);
              const assignee = typeof item === 'object' ? (item.assigned_to || item.assignee) : null;
              return (
                <div key={i} className="ai-json-task-row">
                  <CheckCircle2 size={13} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div className="ai-json-task-content">
                    <span>{itemText}</span>
                    {assignee && <span className="ai-json-assignee">@{assignee}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Array.isArray(blockers) && blockers.length > 0 && (
        <div className="ai-json-section blockers">
          <div className="ai-json-section-header">
            <AlertTriangle size={13} className="ai-json-icon" color="#f87171" />
            <span>Blockers</span>
          </div>
          <div className="ai-json-list">
            {blockers.map((b: any, i: number) => (
              <div key={i} className="ai-json-list-item blocker">
                <span>{typeof b === 'string' ? b : b.text || JSON.stringify(b)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Inline token renderer for bold, code, task IDs, statuses, priorities
function renderInline(text: string): React.ReactNode {
  const tokenRegex = /(\*\*#\d+\*\*|#\d+|\*\*[^*]+\*\*|`[^`]+`|\b(?:pending|in_progress|in progress|completed)\b|\b(?:high|medium|low)\s+priority\b)/gi;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // Task ID: #123
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

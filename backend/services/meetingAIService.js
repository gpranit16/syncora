const { stripThinking } = require('../controllers/aiController');

const getNvidiaApiUrl = () => {
  if (process.env.NVIDIA_API_URL) return process.env.NVIDIA_API_URL;
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.startsWith('sk-or-')) {
    return 'https://openrouter.ai/api/v1';
  }
  return 'https://integrate.api.nvidia.com/v1';
};

const getNvidiaModel = () => {
  if (process.env.NVIDIA_MODEL) return process.env.NVIDIA_MODEL;
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.startsWith('sk-or-')) {
    return 'nvidia/nemotron-3.5-lightning:free';
  }
  return 'nvidia/nemotron-3.5-lightning-30b-a3b';
};

/**
 * Checks if a transcript is essentially trivial (e.g. only greetings, single words, audio check).
 */
const isTrivialTranscript = (transcriptText) => {
  if (!transcriptText || typeof transcriptText !== 'string') return true;
  // Strip speaker labels like "Name: " or "[Name]: " or timestamps
  const stripped = transcriptText
    .replace(/^\[?[^:\]\n]+\]?:\s*/gm, '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g, '')
    .replace(/[^\w\s\u0900-\u097F]/gi, ' ')
    .toLowerCase()
    .trim();

  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  if (words.length <= 16) {
    const greetingWords = new Set([
      'hi', 'hello', 'hey', 'how', 'are', 'you', 'fine', 'good', 'morning',
      'afternoon', 'evening', 'yes', 'no', 'ok', 'okay', 'bye', 'namaste',
      'haan', 'theek', 'thek', 'alvida', 'thanks', 'thank', 'great', 'cool',
      'all', 'good', 'yo', 'sup', 'test', 'testing', 'audio', 'check', 'one', 'two',
      'mic', 'am', 'i', 'doing', 'well'
    ]);
    const nonGreetingWords = words.filter(w => !greetingWords.has(w));
    if (nonGreetingWords.length <= 1) return true;
  }
  return false;
};

/**
 * Checks if a string looks like AI chain-of-thought or internal reasoning commentary.
 */
const isReasoningText = (text) => {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('i need to make sure') ||
    lower.includes('rule ') ||
    lower.includes('json is valid') ||
    lower.includes("i'll output []") ||
    lower.includes('i will output []') ||
    lower.includes('schema') ||
    lower.includes('action_items') ||
    lower.includes('top-level') ||
    lower.includes('check constraints') ||
    lower.includes('draft the summary') ||
    /^(?:-\s*)?I (?:need to|must|should|will) (?:make sure|analyze|check|output|ensure|follow)/i.test(text.trim())
  );
};

/**
 * Clean summary text by stripping preamble, reasoning, and JSON leakage artifacts.
 */
const cleanSummaryText = (text, targetLanguage = 'en') => {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();
  // Strip code blocks and think tags
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  
  // If the entire text is reasoning commentary
  if (isReasoningText(s)) {
    return targetLanguage === 'hi'
      ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
      : 'Brief check-in / greeting with no substantive work items.';
  }

  // Strip preambles like "I'll output:", "Here is the summary:", "Output:", etc.
  s = s.replace(/^(?:I'll output|I will output|Here is (?:the )?(?:summary|output|response)|Output|Response|Sure, here is|Okay, here is|Here's (?:the )?(?:summary|output|response))\s*[:：]?\s*/i, '');
  // Strip json artifacts like { "summary": "..." or "summary": "..."
  s = s.replace(/^\{\s*"?summary"?\s*:\s*["']?/i, '');
  s = s.replace(/^"?summary"?\s*:\s*["']?/i, '');
  s = s.replace(/["']?\s*,\s*"?decisions"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*,\s*"?action_items"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*,\s*"?blockers"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*\}?\s*$/i, '');
  // Strip leftover outer quotes
  s = s.replace(/^["'“]+|["'”]+$/g, '').trim();

  if (isReasoningText(s)) {
    return targetLanguage === 'hi'
      ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
      : 'Brief check-in / greeting with no substantive work items.';
  }

  return s;
};

/**
 * Robust regex extractor when full JSON.parse fails.
 */
const extractStructuredKeys = (text) => {
  const result = {
    summary: '',
    decisions: [],
    action_items: [],
    blockers: [],
    deadlines: []
  };

  if (!text || typeof text !== 'string') return result;

  // Extract summary
  const sumMatch = text.match(/"?summary"?\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
  if (sumMatch && sumMatch[1]) {
    result.summary = sumMatch[1].replace(/\\"/g, '"').trim();
  }

  // Extract decisions
  const decMatch = text.match(/"?decisions"?\s*:\s*\[([\s\S]*?)\]/i);
  if (decMatch && decMatch[1]) {
    try {
      result.decisions = JSON.parse(`[${decMatch[1]}]`);
    } catch (_) {
      result.decisions = decMatch[1].split(/",\s*"/).map(d => d.replace(/[\[\]"']/g, '').trim()).filter(Boolean);
    }
  }

  // Extract action items
  const actMatch = text.match(/"?action_items"?\s*:\s*\[([\s\S]*?)\]/i);
  if (actMatch && actMatch[1]) {
    try {
      result.action_items = JSON.parse(`[${actMatch[1]}]`);
    } catch (_) {}
  }

  // Extract blockers
  const blkMatch = text.match(/"?blockers"?\s*:\s*\[([\s\S]*?)\]/i);
  if (blkMatch && blkMatch[1]) {
    try {
      result.blockers = JSON.parse(`[${blkMatch[1]}]`);
    } catch (_) {
      result.blockers = blkMatch[1].split(/",\s*"/).map(b => b.replace(/[\[\]"']/g, '').trim()).filter(Boolean);
    }
  }

  // Extract deadlines
  const dlnMatch = text.match(/"?deadlines"?\s*:\s*\[([\s\S]*?)\]/i);
  if (dlnMatch && dlnMatch[1]) {
    try {
      result.deadlines = JSON.parse(`[${dlnMatch[1]}]`);
    } catch (_) {
      result.deadlines = dlnMatch[1].split(/",\s*"/).map(d => d.replace(/[\[\]"']/g, '').trim()).filter(Boolean);
    }
  }

  return result;
};

/**
 * Validate and clean the structured AI result.
 */
const sanitizeMeetingSummary = (data, targetLanguage = 'en') => {
  const result = {
    summary: '',
    decisions: [],
    action_items: [],
    blockers: [],
    deadlines: []
  };

  if (!data || typeof data !== 'object') {
    result.summary = targetLanguage === 'hi' 
      ? 'बैठक का कोई ठोस विवरण उपलब्ध नहीं है।'
      : 'No detailed summary available for this meeting.';
    return result;
  }

  // Summary
  if (typeof data.summary === 'string' && data.summary.trim()) {
    result.summary = cleanSummaryText(data.summary);
  }

  if (!result.summary) {
    result.summary = targetLanguage === 'hi' 
      ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
      : 'This was a brief greeting/check-in.';
  }

  // Decisions
  if (Array.isArray(data.decisions)) {
    result.decisions = data.decisions
      .map(d => (typeof d === 'string' ? d.trim() : d && d.title ? String(d.title).trim() : ''))
      .filter(Boolean);
  }

  // Action Items
  if (Array.isArray(data.action_items)) {
    result.action_items = data.action_items
      .map(item => {
        if (typeof item === 'string' && item.trim()) {
          return {
            title: item.trim(),
            assignee: null,
            deadline: null,
            source: null
          };
        }
        if (typeof item === 'object' && item !== null) {
          const title = item.title || item.task || item.description || '';
          if (!title || typeof title !== 'string' || !title.trim()) return null;
          return {
            title: title.trim(),
            assignee: item.assignee && typeof item.assignee === 'string' && item.assignee.toLowerCase() !== 'unassigned' && item.assignee.toLowerCase() !== 'none'
              ? item.assignee.trim()
              : null,
            deadline: item.deadline && typeof item.deadline === 'string' && item.deadline.toLowerCase() !== 'none'
              ? item.deadline.trim()
              : null,
            source: item.source && typeof item.source === 'string' ? item.source.trim() : null
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  // Blockers
  if (Array.isArray(data.blockers)) {
    result.blockers = data.blockers
      .map(b => (typeof b === 'string' ? b.trim() : b && b.title ? String(b.title).trim() : ''))
      .filter(Boolean);
  }

  // Deadlines
  if (Array.isArray(data.deadlines)) {
    result.deadlines = data.deadlines
      .map(dl => (typeof dl === 'string' ? dl.trim() : dl && dl.title ? String(dl.title).trim() : ''))
      .filter(Boolean);
  }

  return result;
};

/**
 * Generate meeting intelligence via NVIDIA Nemotron.
 *
 * @param {string} transcriptText - The complete meeting transcript (with speaker lines where available)
 * @param {string} targetLanguage - 'en' | 'hi' | 'same'
 * @param {Array} participants - List of participant names (optional)
 * @returns {Promise<Object>}
 */
const analyzeMeetingTranscript = async (transcriptText, targetLanguage = 'en', participants = []) => {
  if (!transcriptText || !transcriptText.trim()) {
    return sanitizeMeetingSummary(null, targetLanguage);
  }

  // Fast path for trivial / hello-only meetings to guarantee strict zero hallucination
  if (isTrivialTranscript(transcriptText)) {
    const summaryText = targetLanguage === 'hi'
      ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
      : 'This was a brief greeting/check-in with no substantive work items.';
    return {
      summary: summaryText,
      decisions: [],
      action_items: [],
      blockers: [],
      deadlines: []
    };
  }

  if (!process.env.NVIDIA_API_KEY) {
    throw new Error('NVIDIA API key not configured');
  }

  let languageInstruction = 'Output the summary, decisions, action items, blockers, and deadlines in English.';
  if (targetLanguage === 'hi') {
    languageInstruction = 'Output the entire summary, decisions, action items, blockers, and deadlines in Hindi (हिन्दी) or natural Hinglish where appropriate for technical terms.';
  } else if (targetLanguage === 'same') {
    languageInstruction = 'Output in the dominant language used in the transcript (if Hindi/Hinglish, summarize in Hindi/Hinglish; if English, summarize in English).';
  }

  const participantList = Array.isArray(participants) && participants.length > 0
    ? `Known meeting participants: ${participants.join(', ')}.`
    : '';

  const systemPrompt = `You are Syncora Meeting Intelligence, a strict JSON-only AI engine that extracts summaries, decisions, action items, blockers, and deadlines from meeting transcripts.

CRITICAL INSTRUCTIONS:
- You MUST output ONLY a valid JSON object.
- DO NOT output any thinking, reasoning steps, internal analysis, commentary, or markdown outside the JSON block.
- Start your response IMMEDIATELY with the '{' character and end with '}'.

Schema:
{
  "summary": "Concise executive overview of the meeting",
  "decisions": ["string"],
  "action_items": [
    {
      "title": "string",
      "assignee": "string or null",
      "deadline": "string or null",
      "source": "string or null"
    }
  ],
  "blockers": ["string"],
  "deadlines": ["string"]
}

Rules:
1. ${languageInstruction}
2. Extract ONLY facts, decisions, tasks, blockers, and deadlines that are EXPLICITLY spoken in the transcript.
3. NEVER hallucinate or invent decisions, action items, blockers, or deadlines.
4. If a meeting contains only greetings, check-ins, or no substantive work items, output empty arrays for decisions, action_items, blockers, and deadlines, and write a concise 1-sentence summary that it was a check-in.
5. ${participantList}`;

  const userPrompt = `Meeting Transcript:
${transcriptText}

Generate JSON analysis:`;

  const response = await fetch(`${getNvidiaApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
      'HTTP-Referer': 'https://syncora.app',
      'X-Title': 'Syncora'
    },
    body: JSON.stringify({
      model: getNvidiaModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1500,
      temperature: 0.1,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('NVIDIA API Error (Meeting AI):', errorText);
    throw new Error('Failed to communicate with AI provider');
  }

  const data = await response.json();
  const rawAnswer = data.choices?.[0]?.message?.content || '';

  // Clean reasoning / thinking tokens
  const cleaned = stripThinking(rawAnswer);

  // Extract JSON
  let parsedJson = null;
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsedJson = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.warn('Failed to parse matched JSON block from Nemotron response:', parseErr.message);
    }
  }

  if (!parsedJson) {
    try {
      parsedJson = JSON.parse(cleaned);
    } catch (_) {
      // Robust key-based extraction fallback
      const extracted = extractStructuredKeys(cleaned);
      if (extracted.summary || extracted.decisions.length > 0 || extracted.action_items.length > 0) {
        parsedJson = extracted;
      } else {
        parsedJson = {
          summary: cleanSummaryText(cleaned) || 'Meeting summary could not be structured.',
          decisions: [],
          action_items: [],
          blockers: [],
          deadlines: []
        };
      }
    }
  }

  return sanitizeMeetingSummary(parsedJson, targetLanguage);
};

module.exports = {
  analyzeMeetingTranscript,
  sanitizeMeetingSummary,
  isTrivialTranscript,
  cleanSummaryText,
  extractStructuredKeys,
  getNvidiaApiUrl,
  getNvidiaModel
};


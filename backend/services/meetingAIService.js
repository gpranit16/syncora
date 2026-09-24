const { stripThinking } = require('../controllers/aiController');

const getApiKey = () => {
  const raw = process.env.OPENROUTER_API_KEY || process.env.NVIDIA_API_KEY || '';
  return raw.trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t]/g, '');
};

const getNvidiaApiUrl = () => {
  if (process.env.NVIDIA_API_URL) return process.env.NVIDIA_API_URL;
  const key = getApiKey();
  if (key.startsWith('sk-or-') || process.env.OPENROUTER_API_KEY) {
    return 'https://openrouter.ai/api/v1';
  }
  return 'https://integrate.api.nvidia.com/v1';
};

const getCandidateModels = () => {
  const key = getApiKey();
  const isOR = key.startsWith('sk-or-') || Boolean(process.env.OPENROUTER_API_KEY);
  if (isOR) {
    const list = [
      process.env.NVIDIA_MODEL || process.env.OPENROUTER_MODEL,
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-small-24b-instruct-2501:free',
      'google/gemini-2.0-flash-exp:free',
      'liquid/lfm-2.5-2.6b:free',
      'nvidia/nemotron-3.5-lightning:free'
    ].filter(Boolean);
    return [...new Set(list)];
  }
  return [
    process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
    'meta/llama-3.3-70b-instruct'
  ];
};

/**
 * Checks if a transcript is essentially trivial (e.g. only greetings, single words, audio check).
 */
const isTrivialTranscript = (transcriptText) => {
  if (!transcriptText || typeof transcriptText !== 'string') return true;
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
 * Safely strips XML thinking tags without destroying subsequent content.
 */
const stripThinkingTags = (text) => {
  if (!text || typeof text !== 'string') return '';
  let s = text;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  return s.trim();
};

/**
 * Robust JSON extraction and repair.
 */
const parseAndRepairJSON = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = stripThinkingTags(rawText);

  // 1. Direct parse attempt
  try {
    const res = JSON.parse(cleaned);
    if (res && typeof res === 'object') return res;
  } catch (_) {}

  // 2. Extract outermost JSON block {...}
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

    try {
      const res = JSON.parse(jsonStr);
      if (res && typeof res === 'object') return res;
    } catch (_) {}

    // Fix trailing commas
    let repaired = jsonStr.replace(/,\s*([}\]])/g, '$1');
    try {
      const res = JSON.parse(repaired);
      if (res && typeof res === 'object') return res;
    } catch (_) {}

    // Fix unescaped newlines inside strings
    repaired = repaired.replace(/(?<=:\s*"[^"]*)\r?\n(?=[^"]*")/g, '\\n');
    try {
      const res = JSON.parse(repaired);
      if (res && typeof res === 'object') return res;
    } catch (_) {}
  }

  // 3. Fallback regex field-by-field extraction
  const extracted = extractStructuredKeys(cleaned);
  if (extracted.summary || extracted.decisions.length > 0 || extracted.action_items.length > 0) {
    return extracted;
  }

  return null;
};

/**
 * Clean summary text by stripping preamble, reasoning, and JSON leakage artifacts.
 */
const cleanSummaryText = (text, targetLanguage = 'en') => {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

  // Strip preambles
  s = s.replace(/^(?:I'll output|I will output|Here is (?:the )?(?:summary|output|response)|Output|Response|Sure, here is|Okay, here is|Here's (?:the )?(?:summary|output|response))\s*[:：]?\s*/i, '');
  // Strip json artifacts
  s = s.replace(/^\{\s*"?summary"?\s*:\s*["']?/i, '');
  s = s.replace(/^"?summary"?\s*:\s*["']?/i, '');
  s = s.replace(/["']?\s*,\s*"?decisions"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*,\s*"?action_items"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*,\s*"?blockers"?\s*:\s*\[[\s\S]*$/i, '');
  s = s.replace(/["']?\s*\}?\s*$/i, '');
  s = s.replace(/^["'“]+|["'”]+$/g, '').trim();

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

  // Extract summary with multiline/dotAll support
  const sumMatch = text.match(/"?summary"?\s*:\s*"([\s\S]*?)"(?=\s*,\s*"(?:decisions|action_items|blockers|deadlines)|[\s\n]*\})/i);
  if (sumMatch && sumMatch[1]) {
    result.summary = sumMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
  } else {
    const mdSum = text.match(/(?:###?\s*(?:Executive\s*)?Summary|\*\*Summary:\*\*|Summary:)\s*([^\n#*]+(?:\n[^\n#*]+)*)/i);
    if (mdSum && mdSum[1]) {
      result.summary = mdSum[1].trim();
    }
  }

  // Extract decisions
  const decMatch = text.match(/"?decisions"?\s*:\s*\[([\s\S]*?)\]/i);
  if (decMatch && decMatch[1]) {
    try {
      result.decisions = JSON.parse(`[${decMatch[1].replace(/,\s*$/, '')}]`);
    } catch (_) {
      const items = decMatch[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (items) {
        result.decisions = items.map(d => d.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()).filter(Boolean);
      }
    }
  }

  // Extract action items
  const actMatch = text.match(/"?action_items"?\s*:\s*\[([\s\S]*?)\]/i);
  if (actMatch && actMatch[1]) {
    try {
      result.action_items = JSON.parse(`[${actMatch[1].replace(/,\s*$/, '')}]`);
    } catch (_) {
      const itemBlocks = actMatch[1].match(/\{[\s\S]*?\}/g);
      if (itemBlocks) {
        result.action_items = itemBlocks.map(block => {
          const tMatch = block.match(/"?title"?\s*:\s*"([^"]*)"/i);
          const aMatch = block.match(/"?assignee"?\s*:\s*"([^"]*)"/i);
          const dMatch = block.match(/"?deadline"?\s*:\s*"([^"]*)"/i);
          const sMatch = block.match(/"?source"?\s*:\s*"([^"]*)"/i);
          if (tMatch && tMatch[1]) {
            return {
              title: tMatch[1].trim(),
              assignee: aMatch ? aMatch[1].trim() : null,
              deadline: dMatch ? dMatch[1].trim() : null,
              source: sMatch ? sMatch[1].trim() : null
            };
          }
          return null;
        }).filter(Boolean);
      }
    }
  }

  // Extract blockers
  const blkMatch = text.match(/"?blockers"?\s*:\s*\[([\s\S]*?)\]/i);
  if (blkMatch && blkMatch[1]) {
    try {
      result.blockers = JSON.parse(`[${blkMatch[1].replace(/,\s*$/, '')}]`);
    } catch (_) {
      const items = blkMatch[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (items) {
        result.blockers = items.map(b => b.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()).filter(Boolean);
      }
    }
  }

  // Extract deadlines
  const dlnMatch = text.match(/"?deadlines"?\s*:\s*\[([\s\S]*?)\]/i);
  if (dlnMatch && dlnMatch[1]) {
    try {
      result.deadlines = JSON.parse(`[${dlnMatch[1].replace(/,\s*$/, '')}]`);
    } catch (_) {
      const items = dlnMatch[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (items) {
        result.deadlines = items.map(d => d.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()).filter(Boolean);
      }
    }
  }

  return result;
};

/**
 * Intelligent extractive fallback when AI is offline or returns unstructured output.
 */
const generateHeuristicSummary = (transcriptText, targetLanguage = 'en') => {
  if (!transcriptText || !transcriptText.trim()) {
    return {
      summary: targetLanguage === 'hi'
        ? 'बैठक का कोई विवरण उपलब्ध नहीं है।'
        : 'No transcript was recorded for this meeting.',
      decisions: [],
      action_items: [],
      blockers: [],
      deadlines: []
    };
  }

  const lines = transcriptText
    .split('\n')
    .map(l => l.replace(/^\[?[^:\]\n]+\]?:\s*/, '').trim())
    .filter(l => l.length > 5);

  const cleanSnippet = lines.slice(0, 3).join('. ');
  const summary = targetLanguage === 'hi'
    ? `बैठक में हुई चर्चा: ${cleanSnippet || 'संक्षिप्त चर्चा और समन्वय'}`
    : `Meeting overview: ${cleanSnippet || 'General discussion and team alignment'}.`;

  return {
    summary,
    decisions: [],
    action_items: [],
    blockers: [],
    deadlines: []
  };
};

/**
 * Validate and clean the structured AI result.
 */
const sanitizeMeetingSummary = (data, targetLanguage = 'en', transcriptFallback = '') => {
  const result = {
    summary: '',
    decisions: [],
    action_items: [],
    blockers: [],
    deadlines: []
  };

  if (!data || typeof data !== 'object') {
    return generateHeuristicSummary(transcriptFallback, targetLanguage);
  }

  // Summary
  if (typeof data.summary === 'string' && data.summary.trim()) {
    result.summary = cleanSummaryText(data.summary, targetLanguage);
  }

  if (!result.summary || result.summary.includes('could not be structured')) {
    const heuristic = generateHeuristicSummary(transcriptFallback, targetLanguage);
    result.summary = heuristic.summary;
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
 * Generate meeting intelligence via LLM with multi-model fallback.
 *
 * @param {string} transcriptText - The complete meeting transcript
 * @param {string} targetLanguage - 'en' | 'hi' | 'same'
 * @param {Array} participants - List of participant names (optional)
 * @returns {Promise<Object>}
 */
const analyzeMeetingTranscript = async (transcriptText, targetLanguage = 'en', participants = []) => {
  if (!transcriptText || !transcriptText.trim()) {
    return sanitizeMeetingSummary(null, targetLanguage, '');
  }

  // Fast path for trivial / hello-only meetings to guarantee strict zero hallucination
  if (isTrivialTranscript(transcriptText)) {
    const summaryText = targetLanguage === 'hi'
      ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
      : 'This was a brief greeting / check-in with no substantive work items.';
    return {
      summary: summaryText,
      decisions: [],
      action_items: [],
      blockers: [],
      deadlines: []
    };
  }

  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('[Meeting AI] NVIDIA/OpenRouter API key not configured, using heuristic summary.');
    return generateHeuristicSummary(transcriptText, targetLanguage);
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
- Start your response IMMEDIATELY with '{' and end with '}'.

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
4. If a meeting contains only greetings or short status check-ins, output empty arrays for decisions, action_items, blockers, and deadlines, and write a 1-sentence summary of what was discussed.
5. ${participantList}`;

  const userPrompt = `Meeting Transcript:
${transcriptText}

Generate JSON analysis:`;

  const candidateModels = getCandidateModels();
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(`${getNvidiaApiUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://syncora.app',
          'X-Title': 'Syncora'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1500,
          temperature: 0.1,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[Meeting AI] Model ${model} returned status ${response.status}:`, errorText.slice(0, 120));
        lastError = new Error(`Model ${model} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const rawAnswer = data.choices?.[0]?.message?.content || '';

      if (rawAnswer) {
        const parsed = parseAndRepairJSON(rawAnswer);
        if (parsed) {
          return sanitizeMeetingSummary(parsed, targetLanguage, transcriptText);
        }
      }
    } catch (err) {
      console.warn(`[Meeting AI] Model ${model} failed/timed out:`, err.message);
      lastError = err;
    }
  }

  console.warn('[Meeting AI] All AI models exhausted or failed, falling back to extractive summary:', lastError?.message);
  return generateHeuristicSummary(transcriptText, targetLanguage);
};

module.exports = {
  analyzeMeetingTranscript,
  sanitizeMeetingSummary,
  isTrivialTranscript,
  cleanSummaryText,
  extractStructuredKeys,
  getNvidiaApiUrl,
  getCandidateModels
};



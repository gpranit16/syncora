const db = require('../config/db');

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

const getNvidiaModel = () => {
  if (process.env.NVIDIA_MODEL) return process.env.NVIDIA_MODEL;
  if (process.env.OPENROUTER_MODEL) return process.env.OPENROUTER_MODEL;
  const key = getApiKey();
  if (key.startsWith('sk-or-') || process.env.OPENROUTER_API_KEY) {
    return 'liquid/lfm-2.5-2.6b:free';
  }
  return 'nvidia/nemotron-3.5-lightning-30b-a3b';
};

const MAX_CONTEXT_MESSAGES = 30;
const MAX_CONTEXT_TASKS = 40;
const MAX_PROMPT_LENGTH = 1000;

/**
 * Robust cleaner to strip all forms of leaked thinking / reasoning / chain-of-thought tokens.
 */
const stripThinking = (text, userQuestion = '') => {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  // 1. Remove XML-style think/thought/reasoning tags (closed and unclosed)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, '');
  cleaned = cleaned.replace(/<\/think>/gi, '');
  cleaned = cleaned.replace(/<\/thought>/gi, '');

  // Strip tool call tags
  cleaned = cleaned.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, '');
  cleaned = cleaned.replace(/<\|tool_call_start\|>/gi, '');
  cleaned = cleaned.replace(/<\|tool_call_end\|>/gi, '');

  // 2. Remove "Here's a thinking process:" or similar lead-in blocks
  cleaned = cleaned.replace(/Here(?:'s| is) (?:a |the )?thinking process:?[\s\S]*?(?=\n\n|\r\n\r\n|$)/gi, '');
  cleaned = cleaned.replace(/Thinking Process:?[\s\S]*?(?=\n\n|\r\n\r\n|$)/gi, '');
  cleaned = cleaned.replace(/Thought Process:?[\s\S]*?(?=\n\n|\r\n\r\n|$)/gi, '');

  // 3. Remove conversational meta lead-ins (e.g. "Let's structure the answer:", "Based on the recent messages...")
  cleaned = cleaned.replace(/^(?:Let's structure (?:the answer|the response|this)|Here's (?:how I will|how to) structure|I will (?:now )?structure|Let's organize (?:the answer|this))\s*[:：]?\s*\n*/gi, '');

  // 4. Handle step-by-step reasoning (e.g. "1. Analyze User Input:", "2. Review...", "Possible summary:", "Let's draft it:")
  if (/1\.\s*(?:\*\*)?\s*(?:Analyze|Review|Identify|Determine|Formulate)/i.test(cleaned) ||
      /Possible (?:summary|answer|response):/i.test(cleaned) ||
      /Let's draft (?:it|the summary|the response):/i.test(cleaned)) {
    
    const draftMatch = cleaned.match(/(?:Possible (?:summary|answer|response)|Let's draft (?:it|the summary|the response))\s*[:：]?\s*\n*["'“]?([\s\S]+?)["'”]?\s*(?:\n\s*Check constraints|\n\s*Constraints:|$)/i);
    if (draftMatch && draftMatch[1]) {
      cleaned = draftMatch[1].trim();
    } else {
      const paras = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const filtered = paras.filter(p => !/^(?:\d+\.|\*|Check constraints|Constraints|I'll make sure|Let's draft|Possible summary|I need to output|Analyze User Input)/i.test(p));
      if (filtered.length > 0) {
        cleaned = filtered[filtered.length - 1];
      }
    }
  }

  // 5. Remove conversational chain-of-thought blocks if the model narrates its internal decision process
  const paragraphs = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const reasoningPattern = /^(?:and tags|then final response|i'll reason|i will reason|let me reason|the user is asking|the user asked|based on the (?:context|instruction|rule)|looking at the context|to answer this question|i should respond|i will respond|let's analyze|let's see|first, i need to|determine response|analyze the request|1\.\s*analyze|2\.\s*review|3\.\s*identify|4\.\s*formulate)/i;

  if (paragraphs.length > 1) {
    const nonReasoning = paragraphs.filter(p => !reasoningPattern.test(p));
    if (nonReasoning.length > 0) {
      cleaned = nonReasoning.join('\n\n');
    }
  }

  // Strip leading/trailing leftover quotes
  cleaned = cleaned.replace(/^["'“]+|["'”]+$/g, '').trim();

  // If the extracted text simply echoed the user's question, clear it
  if (userQuestion && cleaned.toLowerCase() === userQuestion.toLowerCase().trim()) {
    cleaned = '';
  }

  return cleaned.trim();
};

/**
 * Fast LLM execution helper with multi-model fallback and per-request timeout.
 */
const executeLLMCall = async (systemPrompt, userPrompt, userQuestion = '', options = {}) => {
  const primaryModel = getNvidiaModel();
  const candidateModels = [
    primaryModel,
    'liquid/lfm-2.5-2.6b:free',
    'z-ai/glm-5.2:free',
    'nex-agi/nex-n2.5-mini:free',
    'nvidia/nemotron-3.5-lightning:free'
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  let lastError = null;
  const timeoutMs = options.timeoutMs || 10000;

  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const apiKey = getApiKey();
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
          max_tokens: options.max_tokens || 800,
          temperature: options.temperature !== undefined ? options.temperature : 0.2,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Model ${model} failed (${response.status}):`, errorText.slice(0, 100));
        lastError = new Error(`Model ${model} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const rawAnswer = data.choices?.[0]?.message?.content || '';
      if (rawAnswer) {
        return rawAnswer;
      }
    } catch (err) {
      console.warn(`Model ${model} error / timeout:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('All AI models unavailable');
};

const checkChannelMembership = async (channelId, userId) => {
  const [members] = await db.promise().query(
    `SELECT c.channel_id, c.workspace_id
     FROM channels c
     INNER JOIN workspace_members wm
       ON c.workspace_id = wm.workspace_id
     WHERE c.channel_id = ? AND wm.user_id = ?`,
    [channelId, userId]
  );
  return members[0];
};

const checkDmAccess = async (targetUserId, userId) => {
  const [users] = await db.promise().query(
    `SELECT user_id FROM users WHERE user_id = ?`,
    [targetUserId]
  );
  return users[0];
};

const fetchChannelContext = async (channelId) => {
  const [messages] = await db.promise().query(
    `SELECT m.message_id, m.message_text, m.created_at,
            u.user_id, u.name as username
     FROM messages m
     INNER JOIN users u ON m.sender_id = u.user_id
     WHERE m.channel_id = ? AND m.is_deleted = FALSE
     ORDER BY m.created_at DESC
     LIMIT ?`,
    [channelId, MAX_CONTEXT_MESSAGES]
  );
  return messages.reverse();
};

const fetchDmContext = async (targetUserId, currentUserId) => {
  const [messages] = await db.promise().query(
    `SELECT dm.direct_message_id as message_id, dm.message_text, dm.created_at,
            u.user_id, u.name as username
     FROM direct_messages dm
     INNER JOIN users u ON dm.sender_id = u.user_id
     WHERE (dm.sender_id = ? AND dm.receiver_id = ?)
        OR (dm.sender_id = ? AND dm.receiver_id = ?)
     ORDER BY dm.created_at DESC
     LIMIT ?`,
    [currentUserId, targetUserId, targetUserId, currentUserId, MAX_CONTEXT_MESSAGES]
  );
  return messages.reverse();
};

// ── Channel/DM AI ─────────────────────────────────────────────────────────────

const askAI = async (req, res) => {
  try {
    const { question, context_type, context_id } = req.body;
    const userId = req.user.user_id;

    if (!question) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }

    if (!getApiKey()) {
      return res.status(500).json({ success: false, message: 'AI API key not configured' });
    }

    let messages = [];

    if (context_type === 'channel' && context_id) {
      const membership = await checkChannelMembership(context_id, userId);
      if (!membership) {
        return res.status(403).json({ success: false, message: 'Not authorized to access this channel' });
      }
      messages = await fetchChannelContext(context_id);
    } else if (context_type === 'dm' && context_id) {
      const access = await checkDmAccess(context_id, userId);
      if (!access) {
        return res.status(403).json({ success: false, message: 'Not authorized to access this direct message' });
      }
      messages = await fetchDmContext(context_id, userId);
    }

    const formattedMessages = messages.map(m => `[${m.username}]: ${m.message_text}`).join('\n');

    const systemPrompt = `You are a helpful, professional AI Assistant in Syncora, a team collaboration workspace.
RULES:
1. Answer directly and concisely based on recent conversation context.
2. NEVER output ASCII/Markdown tables (pipes |). Use clean bullet lists for structured items.
3. If the user greets you, greet them warmly.
4. If info is not in context, state it clearly and concisely.
5. Output ONLY the final response. Never output internal thoughts, reasoning steps, or meta explanations.`;

    const userPrompt = `Recent conversation context:
${formattedMessages || '(No recent messages)'}

User: ${question}`;

    const rawAnswer = await executeLLMCall(systemPrompt, userPrompt, question);
    let answer = stripThinking(rawAnswer, question);
    if (!answer) answer = 'Hello! How can I assist you with this conversation?';

    res.json({ success: true, answer });
  } catch (error) {
    console.error('Error in askAI:', error);
    res.status(500).json({ success: false, message: 'AI service is temporarily unavailable. Please try again.' });
  }
};

// ── Task AI ────────────────────────────────────────────────────────────────────

const fetchTaskContext = async (workspaceId, userId) => {
  const [memberRows] = await db.promise().query(
    "SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId]
  );
  if (memberRows.length === 0) return null;

  const [tasks] = await db.promise().query(
    `SELECT
       t.task_id, t.title, t.description, t.status, t.priority, t.due_date, t.created_at,
       assigned.name AS assigned_to_name, assigned.user_id AS assigned_to,
       creator.name AS created_by_name, creator.user_id AS created_by
     FROM tasks t
     LEFT JOIN users assigned ON t.assigned_to = assigned.user_id
     INNER JOIN users creator ON t.created_by = creator.user_id
     WHERE t.workspace_id = ?
     ORDER BY t.created_at DESC
     LIMIT ?`,
    [workspaceId, MAX_CONTEXT_TASKS]
  );
  return tasks;
};

const formatTasksForPrompt = (tasks, currentUserName) => {
  if (!tasks || tasks.length === 0) return '(No tasks in this workspace yet)';
  const now = new Date();
  return tasks.map(t => {
    const due = t.due_date ? new Date(t.due_date) : null;
    const overdue = due && due < now && t.status !== 'completed' ? ' [OVERDUE]' : '';
    const assignee = t.assigned_to_name ? `→ ${t.assigned_to_name}` : '→ Unassigned';
    const desc = t.description ? ` | Description: "${t.description}"` : '';
    return `[#${t.task_id}] ${t.title}${desc} | ${t.status} | ${t.priority} priority | ${assignee} | Due: ${t.due_date || 'none'}${overdue}`;
  }).join('\n');
};

/**
 * Robust parser to extract action block from JSON or tool-call syntax (e.g. <|tool_call_start|>[task_create(...)]).
 */
const parseActionFromResponse = (rawText, currentUserName, userId) => {
  if (!rawText || typeof rawText !== 'string') return null;

  // 1. Try standard JSON action match
  const jsonMatch = rawText.match(/\{[\s\S]*"action"\s*:\s*true[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const actionData = JSON.parse(jsonMatch[0]);
      if (actionData.action === true) {
        if (actionData.fields && actionData.fields.assigned_to_name) {
          const name = actionData.fields.assigned_to_name.toLowerCase();
          if (name === 'me' || name === currentUserName.toLowerCase()) {
            actionData.fields.assigned_to_name = currentUserName;
            actionData.fields._assigned_to_self = true;
            actionData.fields._assigned_to_user_id = userId;
          }
        }
        return actionData;
      }
    } catch (_) {}
  }

  // 2. Try tool_call syntax: e.g. [task_create(action='create', title='...', ...)]
  const toolCallRegex = /(?:<\|tool_call_start\|>)?\s*\[?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\]?\s*(?:<\|tool_call_end\|>)?/;
  const toolMatch = rawText.match(toolCallRegex);
  if (toolMatch) {
    const fnName = toolMatch[1].toLowerCase();
    const argsStr = toolMatch[2];

    const kwargs = {};
    const argRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^,\s\)]+))/g;
    let m;
    while ((m = argRegex.exec(argsStr)) !== null) {
      const key = m[1];
      const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
      kwargs[key] = val;
    }

    if (fnName.includes('meeting') || kwargs.action === 'schedule_meeting') {
      return {
        action: true,
        type: 'schedule_meeting',
        meeting_data: {
          title: kwargs.title || kwargs.topic || 'Meeting',
          scheduled_start_time: kwargs.due_date || kwargs.scheduled_start_time || kwargs.start_time || null,
          mode: kwargs.mode || 'video',
        },
        preview: `Schedule meeting '${kwargs.title || 'Meeting'}' for ${kwargs.due_date || kwargs.scheduled_start_time || 'scheduled time'}`
      };
    }

    if (fnName.includes('task') || kwargs.title || kwargs.action) {
      const assignedName = kwargs.assigned_to_name || currentUserName;
      const isSelf = assignedName.toLowerCase() === 'me' || assignedName.toLowerCase() === currentUserName.toLowerCase();

      return {
        action: true,
        type: kwargs.action || 'create',
        task_id: kwargs.task_id ? Number(kwargs.task_id) : null,
        fields: {
          title: kwargs.title || 'New Task',
          description: kwargs.description || null,
          priority: ['low', 'medium', 'high'].includes(kwargs.priority) ? kwargs.priority : 'medium',
          status: ['pending', 'in_progress', 'completed'].includes(kwargs.status) ? kwargs.status : 'pending',
          due_date: kwargs.due_date || null,
          assigned_to_name: assignedName,
          _assigned_to_self: isSelf,
          _assigned_to_user_id: isSelf ? userId : undefined,
        },
        preview: `Create task '${kwargs.title || 'New Task'}' with deadline ${kwargs.due_date || 'none'}`
      };
    }
  }

  return null;
};

/**
 * POST /api/ai/ask-tasks
 */
const askTaskAI = async (req, res) => {
  try {
    const { question, workspace_id } = req.body;
    const userId = req.user.user_id;
    const userName = req.user.name || req.user.email || 'User';

    if (!question) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }
    if (!workspace_id) {
      return res.status(400).json({ success: false, message: 'workspace_id is required' });
    }

    if (!getApiKey()) {
      return res.status(500).json({ success: false, message: 'AI API key not configured' });
    }

    const tasks = await fetchTaskContext(workspace_id, userId);
    if (tasks === null) {
      return res.status(403).json({ success: false, message: 'You are not a member of this workspace' });
    }

    const [userRows] = await db.promise().query('SELECT name FROM users WHERE user_id = ?', [userId]);
    const currentUserName = userRows[0]?.name || userName;

    const formattedTasks = formatTasksForPrompt(tasks, currentUserName);

    const nowIso = new Date().toISOString();
    const nowFriendly = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });

    const systemPrompt = `You are an expert AI project, task management, and calendar assistant in Syncora. The current user is "${currentUserName}".
CURRENT DATE & TIME: ${nowFriendly} (${nowIso}).

CRITICAL RULES:
1. NEVER output Markdown/ASCII tables (pipes like |---|).
2. For task listings, use concise bullet points with bold titles and clean badges in parentheses:
   Example:
   • **[#60004] db migrate** (High Priority • Pending • Overdue) — Assigned to Pranit Gupta | "migrate to tidb"
3. DO NOT repeat tasks in a separate "Summary" section if you have already listed them.
4. CONVERSATIONAL CLARIFICATION & SLOT FILLING:
   - If the user wants to schedule a meeting or event but did NOT provide a date/time (e.g. "Schedule a meeting with Aman"), ask them directly and warmly: "Sure! What date and time would you like to schedule the meeting for?"
   - Do NOT force the user to type everything at once; assist them naturally.
5. WRITE ACTIONS:
   When enough details are provided to execute an action, respond ONLY with the JSON action block:
   - For Tasks:
     {"action":true,"type":"create"|"update","task_id":null|number,"fields":{"title":"...","description":"...","priority":"low"|"medium"|"high","status":"pending"|"in_progress"|"completed","due_date":"YYYY-MM-DD HH:mm:ss"|null,"assigned_to_name":"..."},"preview":"Create task '...' with deadline [date/time]"}
   - For Meetings:
     {"action":true,"type":"schedule_meeting","meeting_data":{"title":"...","scheduled_start_time":"YYYY-MM-DD HH:mm:ss","mode":"video"|"voice"},"preview":"Schedule meeting '...' for [Date/Time] with Google Calendar sync"}
   (Calculate exact YYYY-MM-DD HH:mm:ss based on CURRENT DATE & TIME for phrases like "tomorrow 4pm", "next Monday", "kal 3 baje", etc.)
6. Output ONLY the clean final response. Never output internal thoughts, chain-of-thought, or meta reasoning.`;

    const userPrompt = `Workspace Tasks:
${formattedTasks}

User Request: "${question}"`;

    let rawAnswer = '';
    try {
      rawAnswer = await executeLLMCall(systemPrompt, userPrompt, question, { max_tokens: 1024, temperature: 0.2 });
    } catch (err) {
      console.error('LLM Call Error (Task AI):', err.message);
      return res.status(500).json({ success: false, message: 'Failed to communicate with AI provider' });
    }

    // 1. Try to detect an action block (JSON or tool_call) before stripping tags
    const actionData = parseActionFromResponse(rawAnswer, currentUserName, userId);
    if (actionData) {
      return res.json({
        success: true,
        answer: actionData.preview || 'Action ready for confirmation.',
        action: actionData
      });
    }

    // 2. Strip thinking tags and tool call markers
    rawAnswer = stripThinking(rawAnswer, question);

    let answer = rawAnswer.replace(/\{[\s\S]*\}/g, '').trim() || rawAnswer;
    if (!answer) {
      // Find the user's pending tasks to offer contextual guidance
      const myPending = tasks.filter(t => t.status === 'pending' && (!t.assigned_to || t.assigned_to === userId));
      if (myPending.length > 0) {
        const topTask = myPending[0];
        answer = `To complete **#${topTask.task_id} (${topTask.title})**:\n1. Review the task requirements: ${topTask.description || 'No description provided'}.\n2. Move the task status to **In Progress**.\n3. Execute the implementation steps and verify your changes.\n4. Mark the task as **Completed** when done.`;
      } else {
        answer = 'You have no urgent pending tasks right now. You can check your completed tasks or create a new one!';
      }
    }

    res.json({ success: true, answer });
  } catch (error) {
    console.error('Error in askTaskAI:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  askAI,
  askTaskAI,
  stripThinking,
  parseActionFromResponse,
};
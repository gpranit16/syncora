process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = "test";
process.env.NVIDIA_API_KEY = "test-nvidia-key";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");

// Mock DB data
let mockMeetings = [
  {
    meeting_id: 101,
    meeting_code: "abc-def-ghi",
    workspace_id: 1,
    channel_id: 10,
    host_id: 1,
    title: "Sprint Planning",
    mode: "voice",
    status: "ended",
    created_at: new Date()
  },
  {
    meeting_id: 102,
    meeting_code: "xyz-123-789",
    workspace_id: 2,
    channel_id: 20,
    host_id: 3,
    title: "Other Workspace Meeting",
    mode: "voice",
    status: "ended",
    created_at: new Date()
  }
];

let mockTranscripts = [];
let mockSummaries = [];
let mockTasks = [];
let mockWorkspaceMembers = [
  { workspace_id: 1, user_id: 1, role: "admin" },
  { workspace_id: 1, user_id: 2, role: "member" },
  { workspace_id: 1, user_id: 4, role: "member" },
  { workspace_id: 2, user_id: 3, role: "admin" }
];
let mockUsers = [
  { user_id: 1, name: "Pranit", email: "pranit@syncora.app" },
  { user_id: 2, name: "Rahul", email: "rahul@syncora.app" },
  { user_id: 3, user_name: "External", name: "External", email: "ext@other.app" },
  { user_id: 4, name: "Aman", email: "aman@syncora.app" }
];

const mockQuery = jest.fn().mockImplementation((sql, params = []) => {
  const sqlStr = typeof sql === "string" ? sql : "";

  // 1. SELECT meeting by code or id
  if (sqlStr.includes("FROM meetings m") && sqlStr.includes("WHERE m.meeting_code = ? OR m.meeting_id = ?")) {
    const [codeOrId, idNum] = params;
    const found = mockMeetings.filter(m => m.meeting_code === codeOrId || m.meeting_id === Number(idNum) || m.meeting_id === Number(codeOrId));
    const formatted = found.map(m => {
      const u = mockUsers.find(user => user.user_id === m.host_id);
      return { ...m, host_name: u ? u.name : "Host" };
    });
    return Promise.resolve([formatted, []]);
  }

  // 2. Workspace membership check
  if (sqlStr.includes("FROM workspace_members WHERE workspace_id = ? AND user_id = ?")) {
    const [wId, uId] = params;
    const found = mockWorkspaceMembers.filter(m => m.workspace_id === Number(wId) && m.user_id === Number(uId));
    return Promise.resolve([found, []]);
  }

  // 3. Meeting transcripts
  if (sqlStr.includes("INSERT INTO meeting_transcripts")) {
    const [mId, mCode, wId, cId, fullText, segmentsJson, lang] = params;
    const existingIdx = mockTranscripts.findIndex(t => t.meeting_code === mCode);
    const item = {
      transcript_id: existingIdx !== -1 ? mockTranscripts[existingIdx].transcript_id : mockTranscripts.length + 1,
      meeting_id: mId,
      meeting_code: mCode,
      workspace_id: wId,
      channel_id: cId,
      transcript_text: fullText,
      segments: segmentsJson,
      language: lang || "en",
      created_at: new Date(),
      updated_at: new Date()
    };
    if (existingIdx !== -1) {
      mockTranscripts[existingIdx] = item;
    } else {
      mockTranscripts.push(item);
    }
    return Promise.resolve([{ insertId: item.transcript_id }, []]);
  }

  if (sqlStr.includes("SELECT * FROM meeting_transcripts WHERE meeting_code = ?")) {
    const [mCode] = params;
    const found = mockTranscripts.filter(t => t.meeting_code === mCode);
    return Promise.resolve([found, []]);
  }

  // 4. Meeting summaries
  if (sqlStr.includes("INSERT INTO meeting_summaries")) {
    const [mId, mCode, wId, cId, lang, sumText, dec, act, blk, dln] = params;
    const item = {
      summary_id: mockSummaries.length + 1,
      meeting_id: mId,
      meeting_code: mCode,
      workspace_id: wId,
      channel_id: cId,
      language: lang,
      summary_text: sumText,
      decisions: dec,
      action_items: act,
      blockers: blk,
      deadlines: dln,
      created_at: new Date(),
      updated_at: new Date()
    };
    mockSummaries.push(item);
    return Promise.resolve([{ insertId: item.summary_id }, []]);
  }

  if (sqlStr.includes("SELECT * FROM meeting_summaries WHERE meeting_code = ? AND language = ?")) {
    const [mCode, lang] = params;
    const found = mockSummaries.filter(s => s.meeting_code === mCode && s.language === lang);
    return Promise.resolve([found, []]);
  }

  // 5. Meeting participants
  if (sqlStr.includes("SELECT u.name FROM meeting_participants mp")) {
    const [mId] = params;
    return Promise.resolve([[{ name: "Pranit" }, { name: "Rahul" }], []]);
  }

  // 6. User search by name in workspace
  if (sqlStr.includes("FROM workspace_members wm") && sqlStr.includes("LOWER(u.name) LIKE ?")) {
    const [wId, nameParam] = params;
    const search = nameParam.replace(/%/g, "").toLowerCase();
    const matched = mockUsers.find(u => u.name.toLowerCase().includes(search));
    if (matched) {
      return Promise.resolve([[{ user_id: matched.user_id }], []]);
    }
    return Promise.resolve([[], []]);
  }

  // 7. Insert task
  if (sqlStr.includes("INSERT INTO tasks")) {
    const [wId, assignedTo, createdBy, title, desc, priority, dueDate, sourceMeetingId] = params;
    const newId = mockTasks.length + 1;
    const task = {
      task_id: newId,
      workspace_id: wId,
      assigned_to: assignedTo,
      created_by: createdBy,
      title,
      description: desc,
      status: "pending",
      priority,
      due_date: dueDate,
      source_meeting_id: sourceMeetingId,
      created_at: new Date()
    };
    mockTasks.push(task);
    return Promise.resolve([{ insertId: newId }, []]);
  }

  if (sqlStr.includes("SELECT t.*") && sqlStr.includes("FROM tasks t")) {
    const [taskId] = params;
    const found = mockTasks.find(t => t.task_id === Number(taskId));
    if (found) {
      const assigned = mockUsers.find(u => u.user_id === found.assigned_to);
      const creator = mockUsers.find(u => u.user_id === found.created_by);
      return Promise.resolve([[
        {
          ...found,
          assigned_to_name: assigned ? assigned.name : null,
          created_by_name: creator ? creator.name : "Creator"
        }
      ], []]);
    }
    return Promise.resolve([[], []]);
  }

  return Promise.resolve([[], []]);
});

jest.mock("../config/db", () => ({
  promise: () => ({
    query: mockQuery
  })
}));

const meetingRoutes = require("../routes/meetingRoutes");

const app = express();
app.use(express.json());
app.use("/api/meetings", meetingRoutes);

// Auth tokens
const tokenUser1 = jwt.sign({ user_id: 1, name: "Pranit", email: "pranit@syncora.app" }, process.env.JWT_SECRET);
const tokenUser3 = jwt.sign({ user_id: 3, name: "External", email: "ext@other.app" }, process.env.JWT_SECRET);

describe("Meeting AI & Intelligence Test Suite", () => {
  beforeEach(() => {
    mockTranscripts = [];
    mockSummaries = [];
    mockTasks = [];
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  // 1. Authorization
  describe("Transcript Authorization & Security", () => {
    it("should return 401 when no token is provided", async () => {
      const res = await request(app).get("/api/meetings/abc-def-ghi/transcript");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user does not belong to meeting workspace", async () => {
      const res = await request(app)
        .get("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser3}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("should return 404 for non-existent meeting code", async () => {
      const res = await request(app)
        .get("/api/meetings/non-existent-code/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`);
      expect(res.status).toBe(404);
    });
  });

  // 2. Transcript Persistence
  describe("Transcript Save & Retrieval", () => {
    it("should save and retrieve speaker-attributed transcripts", async () => {
      const segments = [
        {
          speaker_id: 1,
          speaker_name: "Pranit",
          text: "Kal backend ka kaam complete karna hai.",
          timestamp: "2026-09-13T10:02:00Z"
        },
        {
          speaker_id: 2,
          speaker_name: "Rahul",
          text: "Haan, main API complete kar dunga.",
          timestamp: "2026-09-13T10:03:00Z"
        }
      ];

      const saveRes = await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          segments,
          language: "hi"
        });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.success).toBe(true);
      expect(saveRes.body.transcript.segments.length).toBe(2);

      const getRes = await request(app)
        .get("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.transcript.transcript_text).toContain("Pranit: Kal backend ka kaam complete karna hai.");
      expect(getRes.body.transcript.transcript_text).toContain("Rahul: Haan, main API complete kar dunga.");
    });
  });

  // 3. Trivial / Hello-Only Meeting (Strict Anti-Hallucination)
  describe("Trivial / Hello-Only Meeting Handling", () => {
    it("should not hallucinate decisions, tasks, blockers, or deadlines for greetings", async () => {
      // Save trivial transcript
      await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          transcript_text: "Pranit: Hello\nRahul: Hi\nPranit: How are you?\nRahul: Fine"
        });

      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary.summary_text).toMatch(/brief (?:greeting|check-in|discussion)/i);
      expect(res.body.summary.decisions).toEqual([]);
      expect(res.body.summary.action_items).toEqual([]);
      expect(res.body.summary.blockers).toEqual([]);
      expect(res.body.summary.deadlines).toEqual([]);
      // Fast path ensures zero external API call
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // 4. Multilingual & Structured Nemotron Summary
  describe("Multilingual & Structured Nemotron Analysis", () => {
    it("should extract decisions, action items, blockers, deadlines from Hindi/Hinglish meeting", async () => {
      await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          transcript_text: "Pranit: Kal backend ka kaam complete karna hai.\nRahul: TiDB migration abhi block hai, main kal dekh lunga.\nPranit: Landing page Friday tak finalize karni hai."
        });

      // Mock Nemotron response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "The team discussed finishing the backend work, the TiDB migration blocker, and finalizing the landing page by Friday.",
                  decisions: ["Landing page must be finalized by Friday."],
                  action_items: [
                    {
                      title: "Resolve TiDB migration",
                      assignee: "Rahul",
                      deadline: "tomorrow",
                      source: "Rahul: TiDB migration abhi block hai, main kal dekh lunga."
                    }
                  ],
                  blockers: ["TiDB migration is currently blocked."],
                  deadlines: ["Landing page — Friday"]
                })
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary.summary_text).toContain("TiDB migration blocker");
      expect(res.body.summary.decisions.length).toBe(1);
      expect(res.body.summary.action_items[0].assignee).toBe("Rahul");
      expect(res.body.summary.blockers[0]).toContain("TiDB migration is currently blocked");
      expect(res.body.summary.deadlines[0]).toContain("Friday");

      // Verify cached retrieval on subsequent call
      const cachedRes = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en" });

      expect(cachedRes.body.cached).toBe(true);
    });

    it("should support Hindi summary output when language='hi'", async () => {
      await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          transcript_text: "Pranit: Kal backend ka kaam complete karna hai.\nRahul: Haan main dekh lunga."
        });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "टीम ने बैकएंड कार्य और एपीआई पूर्णता पर चर्चा की।",
                  decisions: ["कल बैकएंड काम पूरा किया जाएगा।"],
                  action_items: [
                    {
                      title: "बैकएंड एपीआई पूरा करना",
                      assignee: "Rahul",
                      deadline: "कल",
                      source: "Rahul: Haan main dekh lunga."
                    }
                  ],
                  blockers: [],
                  deadlines: ["कल"]
                })
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "hi" });

      expect(res.status).toBe(200);
      expect(res.body.summary.language).toBe("hi");
      expect(res.body.summary.summary_text).toContain("बैकएंड");
    });
  });

  // 5. Action Items -> Real Tasks
  describe("Action Item to Task Conversion", () => {
    it("should convert confirmed action item into a real task with meeting source", async () => {
      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/action-items/convert-task")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          title: "Complete TiDB Migration",
          description: "Follow up on blocker discussed in meeting",
          assignee_name: "Rahul",
          priority: "high",
          deadline: "Friday"
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.task.title).toBe("Complete TiDB Migration");
      expect(res.body.task.assigned_to).toBe(2); // Rahul's user_id
      expect(res.body.task.priority).toBe("high");
      expect(res.body.task.source_meeting_id).toBe(101);
    });

    it("should reject task creation for unauthorized user", async () => {
      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/action-items/convert-task")
        .set("Authorization", `Bearer ${tokenUser3}`)
        .send({
          title: "Unauthorized Task"
        });

      expect(res.status).toBe(403);
    });

    it("should return 400 when task title is missing", async () => {
      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/action-items/convert-task")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          title: ""
        });

      expect(res.status).toBe(400);
    });
  });

  // 6. True Multi-Participant Transcription Pipeline
  describe("Multi-Participant Meeting Transcription Pipeline (3+ Participants)", () => {
    it("should accumulate speech from ALL 3 participants and preserve complete dialogue with attribution", async () => {
      // 3 participants in meeting: Pranit (1), Rahul (2), Aman (4)
      const multiSegments = [
        {
          speaker_id: 1,
          speaker_name: "Pranit",
          text: "Kal backend complete karna hai.",
          timestamp: "2026-09-13T02:18:00Z"
        },
        {
          speaker_id: 2,
          speaker_name: "Rahul",
          text: "Haan, main API dekh lunga.",
          timestamp: "2026-09-13T02:19:00Z"
        },
        {
          speaker_id: 4,
          speaker_name: "Aman",
          text: "Database migration abhi blocked hai.",
          timestamp: "2026-09-13T02:20:00Z"
        },
        {
          speaker_id: 1,
          speaker_name: "Pranit",
          text: "We decided to use TiDB.",
          timestamp: "2026-09-13T02:21:00Z"
        }
      ];

      // Save multi-participant transcript
      const saveRes = await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          segments: multiSegments,
          language: "hi"
        });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.transcript.segments.length).toBe(4);

      // Verify transcript retrieval contains all 4 statements from all 3 participants
      const getRes = await request(app)
        .get("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`);

      expect(getRes.status).toBe(200);
      const text = getRes.body.transcript.transcript_text;
      expect(text).toContain("Pranit: Kal backend complete karna hai.");
      expect(text).toContain("Rahul: Haan, main API dekh lunga.");
      expect(text).toContain("Aman: Database migration abhi blocked hai.");
      expect(text).toContain("Pranit: We decided to use TiDB.");

      // Verify segments array preserves exact speaker identities
      const returnedSegments = getRes.body.transcript.segments;
      expect(returnedSegments[0].speaker_name).toBe("Pranit");
      expect(returnedSegments[1].speaker_name).toBe("Rahul");
      expect(returnedSegments[2].speaker_name).toBe("Aman");
      expect(returnedSegments[3].speaker_name).toBe("Pranit");
    });

    it("should process 3-participant Hindi/Hinglish meeting and generate summary without losing speakers", async () => {
      const multiHindiSegments = [
        {
          speaker_id: 1,
          speaker_name: "Pranit",
          text: "Kal deployment karna hai.",
          timestamp: "2026-09-13T02:25:00Z"
        },
        {
          speaker_id: 2,
          speaker_name: "Rahul",
          text: "Haan, main handle kar lunga.",
          timestamp: "2026-09-13T02:26:00Z"
        }
      ];

      await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          segments: multiHindiSegments,
          language: "hi"
        });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Pranit and Rahul discussed tomorrow's deployment which Rahul will handle.",
                  decisions: ["Deployment is scheduled for tomorrow."],
                  action_items: [
                    {
                      title: "Handle deployment",
                      assignee: "Rahul",
                      deadline: "tomorrow",
                      source: "Rahul: Haan, main handle kar lunga."
                    }
                  ],
                  blockers: [],
                  deadlines: ["Tomorrow"]
                })
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en", force_regenerate: true });

      expect(res.status).toBe(200);
      expect(res.body.summary.summary_text).toContain("Rahul");
      expect(res.body.summary.action_items[0].assignee).toBe("Rahul");
    });

    it("should preserve all 3 participants in simple greeting meeting with no fake tasks", async () => {
      const greetingSegments = [
        { speaker_id: 1, speaker_name: "Pranit", text: "Hello." },
        { speaker_id: 2, speaker_name: "Rahul", text: "Hi." },
        { speaker_id: 4, speaker_name: "Aman", text: "How are you?" }
      ];

      const saveRes = await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          segments: greetingSegments
        });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.transcript.transcript_text).toContain("Pranit: Hello.");
      expect(saveRes.body.transcript.transcript_text).toContain("Rahul: Hi.");
      expect(saveRes.body.transcript.transcript_text).toContain("Aman: How are you?");

      const summaryRes = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en", force_regenerate: true });

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.summary.summary_text).toMatch(/brief (?:greeting|check-in|discussion)/i);
      expect(summaryRes.body.summary.decisions).toEqual([]);
      expect(summaryRes.body.summary.action_items).toEqual([]);
      expect(summaryRes.body.summary.blockers).toEqual([]);
      expect(summaryRes.body.summary.deadlines).toEqual([]);
    });

    it("should reliably accumulate 10+ continuous dialogue segments in a long-duration multi-speaker meeting", async () => {
      const longMeetingSegments = [
        { speaker_id: 1, speaker_name: "Pranit", text: "Meeting start karte hain." },
        { speaker_id: 2, speaker_name: "Rahul", text: "Haan, main presentation load kar raha hoon." },
        { speaker_id: 4, speaker_name: "Aman", text: "Database connection pools optimize karne hain." },
        { speaker_id: 1, speaker_name: "Pranit", text: "TiDB cloud par max connections 100 set karenge." },
        { speaker_id: 2, speaker_name: "Rahul", text: "Auth middleware me token caching implement ho gayi hai." },
        { speaker_id: 4, speaker_name: "Aman", text: "Lekin Redis cluster par memory spike dekhne ko mila hai." },
        { speaker_id: 1, speaker_name: "Pranit", text: "Memory eviction policy ko volatile-lru me change karna padega." },
        { speaker_id: 2, speaker_name: "Rahul", text: "Main yeh change aaj raat tak deploy kar dunga." },
        { speaker_id: 4, speaker_name: "Aman", text: "Great, tab tak main load tests prepare kar leta hoon." },
        { speaker_id: 1, speaker_name: "Pranit", text: "Perfect, kal subah 10 baje review karenge." }
      ];

      const saveRes = await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          segments: longMeetingSegments,
          language: "hi"
        });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.transcript.segments.length).toBe(10);

      const getRes = await request(app)
        .get("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`);

      expect(getRes.status).toBe(200);
      const fullText = getRes.body.transcript.transcript_text;
      expect(fullText).toContain("Pranit: Meeting start karte hain.");
      expect(fullText).toContain("Rahul: Main yeh change aaj raat tak deploy kar dunga.");
      expect(fullText).toContain("Aman: Great, tab tak main load tests prepare kar leta hoon.");
      expect(fullText).toContain("Pranit: Perfect, kal subah 10 baje review karenge.");
    });

    it("should never expose internal reasoning or prompt meta-commentary in the summary", async () => {
      await request(app)
        .post("/api/meetings/abc-def-ghi/transcript")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({
          transcript_text: "Pranit: Kal demo presentation hai."
        });

      // Simulate model returning Chain-of-Thought
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: `- I need to make sure the JSON is valid and follows the exact schema. Rule 5 says deadline can be null. I'll output [] since no deadlines were agreed upon.\n\n{\n  "summary": "The team discussed the upcoming demo presentation scheduled for tomorrow.",\n  "decisions": ["Demo presentation is scheduled for tomorrow."],\n  "action_items": [],\n  "blockers": [],\n  "deadlines": ["Tomorrow"]\n}`
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post("/api/meetings/abc-def-ghi/summary")
        .set("Authorization", `Bearer ${tokenUser1}`)
        .send({ language: "en", force_regenerate: true });

      expect(res.status).toBe(200);
      expect(res.body.summary.summary_text).not.toContain("I need to make sure");
      expect(res.body.summary.summary_text).not.toContain("Rule 5");
      expect(res.body.summary.summary_text).toContain("demo presentation");
    });
  });
});


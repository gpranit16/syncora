const { google } = require("googleapis");
const db = require("../config/db");

const getOAuthClient = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8001/api/v1/integrations/google/calendar/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not fully configured in environment");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

/**
 * Generate Google OAuth Consent Screen URL
 */
const generateAuthUrl = (userId) => {
  const oauth2Client = getOAuthClient();
  const state = Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString("base64");

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Force to get refresh_token
    scope: SCOPES,
    state,
  });
};

/**
 * Handle OAuth Callback - exchange code for tokens and store in DB
 */
const handleOAuthCallback = async (code, state) => {
  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
    userId = decoded.userId;
  } catch (e) {
    throw new Error("Invalid OAuth state parameter");
  }

  if (!userId) {
    throw new Error("User ID missing from OAuth state");
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Retrieve user's email
  let googleEmail = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    googleEmail = userInfo.data.email || null;
  } catch (err) {
    console.warn("Could not fetch userinfo from Google:", err.message);
  }

  const tokenExpiry = tokens.expiry_date || (Date.now() + 3600 * 1000);

  // Upsert into user_calendar_integrations
  await db.promise().query(
    `INSERT INTO user_calendar_integrations 
      (user_id, google_email, access_token, refresh_token, token_expiry, sync_tasks, sync_meetings)
     VALUES (?, ?, ?, ?, ?, TRUE, TRUE)
     ON DUPLICATE KEY UPDATE
      google_email = COALESCE(VALUES(google_email), google_email),
      access_token = VALUES(access_token),
      refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
      token_expiry = VALUES(token_expiry),
      updated_at = CURRENT_TIMESTAMP`,
    [userId, googleEmail, tokens.access_token, tokens.refresh_token || null, tokenExpiry]
  );

  return { userId, googleEmail };
};

/**
 * Helper to get authenticated Google Calendar client for a given user
 */
const getUserCalendarClient = async (userId) => {
  const [rows] = await db.promise().query(
    "SELECT * FROM user_calendar_integrations WHERE user_id = ?",
    [userId]
  );

  if (!rows || rows.length === 0 || !rows[0].access_token) {
    return null;
  }

  const integration = rows[0];
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.token_expiry,
  });

  // Listen for automatic token refreshes and update DB
  oauth2Client.on("tokens", async (newTokens) => {
    try {
      await db.promise().query(
        `UPDATE user_calendar_integrations 
         SET access_token = ?, 
             refresh_token = COALESCE(?, refresh_token),
             token_expiry = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [
          newTokens.access_token,
          newTokens.refresh_token || null,
          newTokens.expiry_date || (Date.now() + 3600 * 1000),
          userId,
        ]
      );
    } catch (updateErr) {
      console.error("Failed to update refreshed tokens in DB:", updateErr.message);
    }
  });

  return {
    calendar: google.calendar({ version: "v3", auth: oauth2Client }),
    integration,
  };
};

/**
 * Format a Date to RFC3339 string (e.g. 2026-09-26T15:00:00Z)
 */
const formatRFC3339 = (date) => {
  return date.toISOString();
};

/**
 * Parse due_date string into start and end Date objects
 */
const parseTaskDateTimes = (dueDateStr) => {
  if (!dueDateStr) return null;
  const d = new Date(dueDateStr);
  if (isNaN(d.getTime())) return null;

  // If time is 00:00:00 (pure date), set event from 09:00 to 10:00 or all day
  const hours = d.getHours();
  const minutes = d.getMinutes();
  
  let start = new Date(d);
  let end = new Date(d);

  if (hours === 0 && minutes === 0) {
    // Default to 10:00 AM - 11:00 AM on that day
    start.setHours(10, 0, 0, 0);
    end.setHours(11, 0, 0, 0);
  } else {
    // End is due date, start is 30 mins before
    start = new Date(d.getTime() - 30 * 60 * 1000);
    end = new Date(d.getTime());
  }

  return { start, end };
};

/**
 * Sync a Task to Google Calendar (Create or Update)
 */
const syncTaskToCalendar = async (userId, task) => {
  try {
    if (!task || !task.due_date) return null;

    const userClient = await getUserCalendarClient(userId);
    if (!userClient || !userClient.integration.sync_tasks) {
      return null;
    }

    const { calendar } = userClient;
    const dateTimes = parseTaskDateTimes(task.due_date);
    if (!dateTimes) return null;

    const appOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",")[0] : "http://localhost:5173";
    const priorityEmoji = task.priority === "high" ? "🔴" : task.priority === "medium" ? "🟡" : "🟢";

    const requestBody = {
      summary: `📌 [Task] ${task.title}`,
      description: `${task.description || "No description provided."}\n\nPriority: ${priorityEmoji} ${(task.priority || "medium").toUpperCase()}\nStatus: ${(task.status || "pending").replace("_", " ").toUpperCase()}\n\nView in Syncora: ${appOrigin}`,
      start: {
        dateTime: formatRFC3339(dateTimes.start),
      },
      end: {
        dateTime: formatRFC3339(dateTimes.end),
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 30 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    // Check if we previously synced this task
    const [existingSync] = await db.promise().query(
      `SELECT * FROM calendar_sync_events 
       WHERE user_id = ? AND event_type = 'task' AND source_id = ?`,
      [userId, task.task_id]
    );

    if (existingSync.length > 0) {
      const googleEventId = existingSync[0].google_event_id;
      try {
        const updated = await calendar.events.update({
          calendarId: "primary",
          eventId: googleEventId,
          requestBody,
        });
        return updated.data;
      } catch (err) {
        if (err.code === 404) {
          // Event was deleted in Google Calendar, re-insert
          const created = await calendar.events.insert({
            calendarId: "primary",
            requestBody,
          });
          await db.promise().query(
            "UPDATE calendar_sync_events SET google_event_id = ? WHERE sync_id = ?",
            [created.data.id, existingSync[0].sync_id]
          );
          return created.data;
        }
        throw err;
      }
    } else {
      const created = await calendar.events.insert({
        calendarId: "primary",
        requestBody,
      });

      await db.promise().query(
        `INSERT INTO calendar_sync_events 
          (user_id, event_type, source_id, google_event_id, calendar_id)
         VALUES (?, 'task', ?, ?, 'primary')`,
        [userId, task.task_id, created.data.id]
      );

      return created.data;
    }
  } catch (error) {
    console.error(`Error syncing task #${task?.task_id} to Google Calendar:`, error.message);
    return null;
  }
};

/**
 * Delete a Task event from Google Calendar
 */
const deleteTaskFromCalendar = async (userId, taskId) => {
  try {
    const [existingSync] = await db.promise().query(
      `SELECT * FROM calendar_sync_events 
       WHERE user_id = ? AND event_type = 'task' AND source_id = ?`,
      [userId, taskId]
    );

    if (existingSync.length === 0) return false;

    const userClient = await getUserCalendarClient(userId);
    if (userClient) {
      try {
        await userClient.calendar.events.delete({
          calendarId: "primary",
          eventId: existingSync[0].google_event_id,
        });
      } catch (err) {
        if (err.code !== 404) {
          console.warn("Could not delete task event from Google Calendar:", err.message);
        }
      }
    }

    await db.promise().query(
      "DELETE FROM calendar_sync_events WHERE sync_id = ?",
      [existingSync[0].sync_id]
    );

    return true;
  } catch (error) {
    console.error(`Error deleting task #${taskId} from Google Calendar:`, error.message);
    return false;
  }
};

/**
 * Sync a Meeting to Google Calendar (Create or Update)
 */
const syncMeetingToCalendar = async (hostId, meeting, participantEmails = []) => {
  try {
    if (!meeting || !meeting.meeting_code) return null;

    const userClient = await getUserCalendarClient(hostId);
    if (!userClient || !userClient.integration.sync_meetings) {
      return null;
    }

    const { calendar } = userClient;
    const appOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",")[0] : "http://localhost:5173";
    const meetingUrl = `${appOrigin}/meet/${meeting.meeting_code}`;

    let start = meeting.scheduled_start_time ? new Date(meeting.scheduled_start_time) : new Date();
    let end = meeting.scheduled_end_time 
      ? new Date(meeting.scheduled_end_time) 
      : new Date(start.getTime() + 30 * 60 * 1000); // 30 min duration default

    if (isNaN(start.getTime())) start = new Date();
    if (isNaN(end.getTime())) end = new Date(start.getTime() + 30 * 60 * 1000);

    const attendees = participantEmails
      .filter(Boolean)
      .map((email) => ({ email }));

    const requestBody = {
      summary: `🎥 [Syncora] ${meeting.title || "Team Meeting"}`,
      description: `Join Syncora Meeting:\n${meetingUrl}\n\nFormat: ${(meeting.mode || "video").toUpperCase()}\nMeeting Code: ${meeting.meeting_code}`,
      location: meetingUrl,
      start: {
        dateTime: formatRFC3339(start),
      },
      end: {
        dateTime: formatRFC3339(end),
      },
      attendees: attendees.length > 0 ? attendees : undefined,
      conferenceData: {
        createRequest: undefined,
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 10 },
          { method: "popup", minutes: 5 },
        ],
      },
    };

    // Check if previously synced
    const [existingSync] = await db.promise().query(
      `SELECT * FROM calendar_sync_events 
       WHERE user_id = ? AND event_type = 'meeting' AND source_id = ?`,
      [hostId, meeting.meeting_id]
    );

    if (existingSync.length > 0) {
      const googleEventId = existingSync[0].google_event_id;
      try {
        const updated = await calendar.events.update({
          calendarId: "primary",
          eventId: googleEventId,
          requestBody,
        });
        return updated.data;
      } catch (err) {
        if (err.code === 404) {
          const created = await calendar.events.insert({
            calendarId: "primary",
            requestBody,
          });
          await db.promise().query(
            "UPDATE calendar_sync_events SET google_event_id = ? WHERE sync_id = ?",
            [created.data.id, existingSync[0].sync_id]
          );
          return created.data;
        }
        throw err;
      }
    } else {
      const created = await calendar.events.insert({
        calendarId: "primary",
        requestBody,
      });

      await db.promise().query(
        `INSERT INTO calendar_sync_events 
          (user_id, event_type, source_id, google_event_id, calendar_id)
         VALUES (?, 'meeting', ?, ?, 'primary')`,
        [hostId, meeting.meeting_id, created.data.id]
      );

      return created.data;
    }
  } catch (error) {
    console.error(`Error syncing meeting #${meeting?.meeting_id} to Google Calendar:`, error.message);
    return null;
  }
};

/**
 * Get status of user's Google Calendar integration
 */
const getUserIntegrationStatus = async (userId) => {
  const [rows] = await db.promise().query(
    `SELECT google_email, sync_tasks, sync_meetings, created_at, updated_at 
     FROM user_calendar_integrations 
     WHERE user_id = ?`,
    [userId]
  );

  if (rows.length === 0) {
    return {
      connected: false,
      email: null,
      sync_tasks: false,
      sync_meetings: false,
    };
  }

  const row = rows[0];
  return {
    connected: true,
    email: row.google_email,
    sync_tasks: Boolean(row.sync_tasks),
    sync_meetings: Boolean(row.sync_meetings),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

/**
 * Update sync settings for a user
 */
const updateSyncSettings = async (userId, { sync_tasks, sync_meetings }) => {
  const updates = [];
  const params = [];

  if (sync_tasks !== undefined) {
    updates.push("sync_tasks = ?");
    params.push(Boolean(sync_tasks));
  }
  if (sync_meetings !== undefined) {
    updates.push("sync_meetings = ?");
    params.push(Boolean(sync_meetings));
  }

  if (updates.length === 0) return true;

  params.push(userId);
  await db.promise().query(
    `UPDATE user_calendar_integrations 
     SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP 
     WHERE user_id = ?`,
    params
  );
  return true;
};

/**
 * Disconnect Google Calendar integration
 */
const disconnectUserCalendar = async (userId) => {
  await db.promise().query(
    "DELETE FROM calendar_sync_events WHERE user_id = ?",
    [userId]
  );
  await db.promise().query(
    "DELETE FROM user_calendar_integrations WHERE user_id = ?",
    [userId]
  );
  return true;
};

module.exports = {
  generateAuthUrl,
  handleOAuthCallback,
  getUserCalendarClient,
  syncTaskToCalendar,
  deleteTaskFromCalendar,
  syncMeetingToCalendar,
  getUserIntegrationStatus,
  updateSyncSettings,
  disconnectUserCalendar,
};

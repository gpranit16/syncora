const {
  generateAuthUrl,
  handleOAuthCallback,
  getUserIntegrationStatus,
  updateSyncSettings,
  disconnectUserCalendar,
} = require("../services/googleCalendarService");

const getFrontendBaseUrl = () => {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, "");
  }
  if (process.env.CORS_ORIGIN) {
    const origins = process.env.CORS_ORIGIN.split(",").map((o) => o.trim());
    return origins[0] || "http://localhost:5173";
  }
  return "http://localhost:5173";
};

const getConnectUrl = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const authUrl = generateAuthUrl(userId);
    return res.json({ success: true, authUrl });
  } catch (error) {
    console.error("Error generating Google Calendar auth URL:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate auth URL",
    });
  }
};

const oauthCallback = async (req, res) => {
  const frontendUrl = getFrontendBaseUrl();
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.warn("Google OAuth returned error:", error);
      return res.redirect(`${frontendUrl}?calendar_connected=error&message=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}?calendar_connected=error&message=Missing_authorization_code`);
    }

    const { googleEmail } = await handleOAuthCallback(code, state);
    console.log(`Google Calendar connected successfully for email: ${googleEmail}`);

    return res.redirect(`${frontendUrl}?calendar_connected=success&email=${encodeURIComponent(googleEmail || "")}`);
  } catch (err) {
    console.error("Error handling Google OAuth callback:", err);
    return res.redirect(`${frontendUrl}?calendar_connected=error&message=${encodeURIComponent(err.message || "OAuth_failed")}`);
  }
};

const getStatus = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const status = await getUserIntegrationStatus(userId);
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error("Error fetching integration status:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const updateSettings = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { sync_tasks, sync_meetings } = req.body;
    await updateSyncSettings(userId, { sync_tasks, sync_meetings });
    return res.json({ success: true, message: "Sync settings updated successfully" });
  } catch (error) {
    console.error("Error updating sync settings:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const disconnect = async (req, res) => {
  try {
    const userId = req.user.user_id;
    await disconnectUserCalendar(userId);
    return res.json({ success: true, message: "Google Calendar disconnected successfully" });
  } catch (error) {
    console.error("Error disconnecting Google Calendar:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getConnectUrl,
  oauthCallback,
  getStatus,
  updateSettings,
  disconnect,
};

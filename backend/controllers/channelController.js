const db = require("../config/db");

const createChannel = async (req, res) => {
  try {
    const { workspace_id, name, description } = req.body;
    const userId = req.user.user_id;

    if (!workspace_id || !name) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID and channel name are required",
      });
    }

    const [members] = await db.promise().query(
      "SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspace_id, userId]
    );

    if (members.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    const [result] = await db.promise().query(
      "INSERT INTO channels (workspace_id, name, description) VALUES (?, ?, ?)",
      [workspace_id, name, description || null]
    );

    return res.status(201).json({
      success: true,
      message: "Channel created successfully",
      channel: {
        channel_id: result.insertId,
        workspace_id,
        name,
        description: description || null,
      },
    });
  } catch (error) {
    console.error("Create channel error:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A channel with this name already exists in this workspace",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error while creating channel",
    });
  }
};

const getWorkspaceChannels = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.user_id;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
      });
    }

    const [members] = await db.promise().query(
      "SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (members.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    const [channels] = await db.promise().query(
      `SELECT channel_id, workspace_id, name, description, created_at
       FROM channels
       WHERE workspace_id = ?
       ORDER BY created_at ASC`,
      [workspaceId]
    );

    return res.status(200).json({
      success: true,
      channels,
    });
  } catch (error) {
    console.error("Get channels error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching channels",
    });
  }
};

const deleteChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.user_id;

    const [channel] = await db.promise().query(
      "SELECT workspace_id, name FROM channels WHERE channel_id = ?",
      [channelId]
    );

    if (channel.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    const workspaceId = channel[0].workspace_id;

    const [member] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (member.length === 0 || !['owner', 'admin'].includes(member[0].role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only workspace owners and admins can delete channels",
      });
    }

    await db.promise().query("DELETE FROM channels WHERE channel_id = ?", [channelId]);

    return res.status(200).json({
      success: true,
      message: `Channel #${channel[0].name} deleted successfully`,
    });
  } catch (error) {
    console.error("Delete channel error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting channel",
    });
  }
};

module.exports = {
  createChannel,
  getWorkspaceChannels,
  deleteChannel,
};

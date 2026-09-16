const db = require("../config/db");

const createWorkspace = async (req, res) => {
  const connection = db.promise();

  try {
    const { name, description } = req.body;
    const userId = req.user.user_id;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Workspace name is required",
      });
    }

    await connection.beginTransaction();

    const [workspaceResult] = await connection.query(
      "INSERT INTO workspaces (name, description, owner_id) VALUES (?, ?, ?)",
      [name, description || null, userId]
    );

    const workspaceId = workspaceResult.insertId;

    await connection.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
      [workspaceId, userId, "owner"]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Workspace created successfully",
      workspace: {
        workspace_id: workspaceId,
        name,
        description: description || null,
        owner_id: userId,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("Create workspace error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while creating workspace",
    });
  }
};

const getUserWorkspaces = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [workspaces] = await db.promise().query(
      `SELECT
        w.workspace_id,
        w.name,
        w.description,
        w.owner_id,
        wm.role,
        w.created_at
      FROM workspaces w
      INNER JOIN workspace_members wm
        ON w.workspace_id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      workspaces,
    });
  } catch (error) {
    console.error("Get workspaces error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching workspaces",
    });
  }
};

const addMemberByEmail = async (req, res) => {
  const connection = db.promise();
  try {
    const { workspace_id, email, role = 'member' } = req.body;
    const requesterId = req.user.user_id;

    // Check requester role
    const [requester] = await connection.query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspace_id, requesterId]
    );

    if (requester.length === 0 || !['owner', 'admin'].includes(requester[0].role)) {
      return res.status(403).json({ success: false, message: "Only owners and admins can invite members" });
    }
    
    const [users] = await connection.query("SELECT user_id FROM users WHERE email = ?", [email]);
    if (users.length === 0) return res.status(404).json({ success: false, message: "User with this email not found" });
    const newMemberId = users[0].user_id;

    // Check if banned
    const [banned] = await connection.query(
      "SELECT ban_id FROM workspace_banned_users WHERE workspace_id = ? AND user_id = ?",
      [workspace_id, newMemberId]
    );
    if (banned.length > 0) {
      return res.status(403).json({ success: false, message: "This user is banned from this workspace and cannot be added" });
    }

    const [member] = await connection.query("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?", [workspace_id, newMemberId]);
    if (member.length > 0) return res.status(400).json({ success: false, message: "User is already a member" });

    // Admin can only add as 'member', Owner can add as 'member' or 'admin'
    const assignedRole = requester[0].role === 'owner' && role === 'admin' ? 'admin' : 'member';

    await connection.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)", [workspace_id, newMemberId, assignedRole]);

    return res.status(200).json({ success: true, message: "Member added successfully" });
  } catch (error) {
    console.error("Add member error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getAvailableWorkspaces = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [workspaces] = await db.promise().query(
      `SELECT w.workspace_id, w.name, w.description, u.name as owner_name 
       FROM workspaces w 
       JOIN users u ON w.owner_id = u.user_id
       WHERE w.workspace_id NOT IN (
         SELECT workspace_id FROM workspace_members WHERE user_id = ?
       )
       AND w.workspace_id NOT IN (
         SELECT workspace_id FROM workspace_banned_users WHERE user_id = ?
       )`, [userId, userId]
    );
    return res.status(200).json({ success: true, workspaces });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const joinWorkspace = async (req, res) => {
  const connection = db.promise();
  try {
    const { workspace_id } = req.body;
    const userId = req.user.user_id;

    if (!workspace_id) return res.status(400).json({ success: false, message: "Workspace ID required" });

    const [ws] = await connection.query("SELECT * FROM workspaces WHERE workspace_id = ?", [workspace_id]);
    if (ws.length === 0) return res.status(404).json({ success: false, message: "Workspace not found" });

    // Check if banned
    const [banned] = await connection.query(
      "SELECT ban_id FROM workspace_banned_users WHERE workspace_id = ? AND user_id = ?",
      [workspace_id, userId]
    );
    if (banned.length > 0) {
      return res.status(403).json({ success: false, message: "You are banned from this workspace" });
    }

    const [member] = await connection.query("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?", [workspace_id, userId]);
    if (member.length > 0) return res.status(400).json({ success: false, message: "Already a member" });

    await connection.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)", [workspace_id, userId, "member"]);

    return res.status(200).json({ success: true, message: "Joined workspace" });
  } catch (error) {
    console.error("Join workspace error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getWorkspaceMembers = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const [members] = await db.promise().query(
      `SELECT u.user_id, u.name, u.email, u.avatar_url, wm.role, wm.joined_at 
       FROM users u 
       JOIN workspace_members wm ON u.user_id = wm.user_id 
       WHERE wm.workspace_id = ?
       ORDER BY 
         CASE wm.role 
           WHEN 'owner' THEN 1 
           WHEN 'admin' THEN 2 
           ELSE 3 
         END, u.name ASC`,
      [workspaceId]
    );
    return res.status(200).json({ success: true, members });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update member role (Owner only: promote to admin or demote to member)
const updateMemberRole = async (req, res) => {
  try {
    const { workspaceId, userId } = req.params;
    const { role } = req.body;
    const requesterId = req.user.user_id;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Allowed roles to assign are 'admin' or 'member'",
      });
    }

    // Check requester is owner
    const [requester] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, requesterId]
    );

    if (requester.length === 0 || requester[0].role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only the workspace owner can modify member roles",
      });
    }

    // Check target member
    const [target] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (target.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User is not a member of this workspace",
      });
    }

    if (target[0].role === 'owner') {
      return res.status(400).json({
        success: false,
        message: "Cannot modify workspace owner role",
      });
    }

    await db.promise().query(
      "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
      [role, workspaceId, userId]
    );

    return res.status(200).json({
      success: true,
      message: `Member role updated to ${role} successfully`,
      role,
    });
  } catch (error) {
    console.error("Update member role error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while updating member role",
    });
  }
};

// Remove member from workspace/group
const removeMember = async (req, res) => {
  try {
    const { workspaceId, userId } = req.params;
    const requesterId = req.user.user_id;

    // Check requester role
    const [requester] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, requesterId]
    );

    if (requester.length === 0 || !['owner', 'admin'].includes(requester[0].role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only workspace owners and admins can remove members",
      });
    }

    const requesterRole = requester[0].role;

    // Check target member
    const [target] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (target.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User is not a member of this workspace",
      });
    }

    const targetRole = target[0].role;

    if (targetRole === 'owner') {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Cannot remove the workspace owner",
      });
    }

    if (requesterRole === 'admin' && targetRole === 'admin') {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Admins cannot remove other admins",
      });
    }

    if (Number(requesterId) === Number(userId)) {
      return res.status(400).json({
        success: false,
        message: "Cannot remove yourself with this action",
      });
    }

    await db.promise().query(
      "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Member removed from workspace successfully",
    });
  } catch (error) {
    console.error("Remove member error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while removing member",
    });
  }
};

// Ban member from workspace/group
const banMember = async (req, res) => {
  const connection = db.promise();
  try {
    const { workspaceId, userId } = req.params;
    const { reason = 'Banned by admin/owner' } = req.body || {};
    const requesterId = req.user.user_id;

    // Check requester role
    const [requester] = await connection.query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, requesterId]
    );

    if (requester.length === 0 || !['owner', 'admin'].includes(requester[0].role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only workspace owners and admins can ban members",
      });
    }

    const requesterRole = requester[0].role;

    // Check target member
    const [target] = await connection.query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (target.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User is not a member of this workspace",
      });
    }

    const targetRole = target[0].role;

    if (targetRole === 'owner') {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Cannot ban the workspace owner",
      });
    }

    if (requesterRole === 'admin' && targetRole === 'admin') {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Admins cannot ban other admins",
      });
    }

    if (Number(requesterId) === Number(userId)) {
      return res.status(400).json({
        success: false,
        message: "Cannot ban yourself",
      });
    }

    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO workspace_banned_users (workspace_id, user_id, banned_by, reason)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE banned_by = VALUES(banned_by), reason = VALUES(reason), created_at = CURRENT_TIMESTAMP`,
      [workspaceId, userId, requesterId, reason]
    );

    await connection.query(
      "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "User banned and removed from workspace successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Ban member error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while banning user",
    });
  }
};

// Unban user from workspace
const unbanMember = async (req, res) => {
  try {
    const { workspaceId, userId } = req.params;
    const requesterId = req.user.user_id;

    const [requester] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, requesterId]
    );

    if (requester.length === 0 || !['owner', 'admin'].includes(requester[0].role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only workspace owners and admins can unban users",
      });
    }

    const [result] = await db.promise().query(
      "DELETE FROM workspace_banned_users WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User was not banned in this workspace",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User unbanned successfully",
    });
  } catch (error) {
    console.error("Unban member error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while unbanning user",
    });
  }
};

// Get list of banned users for workspace
const getBannedMembers = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const requesterId = req.user.user_id;

    const [requester] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, requesterId]
    );

    if (requester.length === 0 || !['owner', 'admin'].includes(requester[0].role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. Only workspace owners and admins can view banned users",
      });
    }

    const [banned_members] = await db.promise().query(
      `SELECT b.ban_id, b.workspace_id, b.user_id, b.banned_by, b.reason, b.created_at,
              u.name, u.email,
              banner.name as banned_by_name
       FROM workspace_banned_users b
       JOIN users u ON b.user_id = u.user_id
       LEFT JOIN users banner ON b.banned_by = banner.user_id
       WHERE b.workspace_id = ?
       ORDER BY b.created_at DESC`,
      [workspaceId]
    );

    return res.status(200).json({
      success: true,
      banned_members,
    });
  } catch (error) {
    console.error("Get banned members error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching banned members",
    });
  }
};

module.exports = {
  createWorkspace,
  getUserWorkspaces,
  addMemberByEmail,
  getAvailableWorkspaces,
  joinWorkspace,
  getWorkspaceMembers,
  updateMemberRole,
  removeMember,
  banMember,
  unbanMember,
  getBannedMembers,
};

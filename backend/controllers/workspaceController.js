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
    
    const [users] = await connection.query("SELECT user_id FROM users WHERE email = ?", [email]);
    if (users.length === 0) return res.status(404).json({ success: false, message: "User with this email not found" });
    const newMemberId = users[0].user_id;

    const [member] = await connection.query("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?", [workspace_id, newMemberId]);
    if (member.length > 0) return res.status(400).json({ success: false, message: "User is already a member" });

    await connection.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)", [workspace_id, newMemberId, role]);

    return res.status(200).json({ success: true, message: "Member added successfully" });
  } catch (error) {
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
       )`, [userId]
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
      `SELECT u.user_id, u.name, u.email, wm.role 
       FROM users u 
       JOIN workspace_members wm ON u.user_id = wm.user_id 
       WHERE wm.workspace_id = ?`,
      [workspaceId]
    );
    return res.status(200).json({ success: true, members });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createWorkspace,
  getUserWorkspaces,
  addMemberByEmail,
  getAvailableWorkspaces,
  joinWorkspace,
  getWorkspaceMembers
};

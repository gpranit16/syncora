const db = require("../config/db");
const { syncTaskToCalendar, deleteTaskFromCalendar } = require("../services/googleCalendarService");

const allowedStatuses = ["pending", "in_progress", "completed"];
const allowedPriorities = ["low", "medium", "high"];

const checkWorkspaceMembership = async (workspaceId, userId) => {
  const [members] = await db.promise().query(
    "SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId]
  );

  return members.length > 0;
};

const createTask = async (req, res) => {
  try {
    const {
      workspace_id,
      assigned_to,
      title,
      description,
      status,
      priority,
      due_date,
    } = req.body;
    const userId = req.user.user_id;

    if (!workspace_id || !title) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID and task title are required",
      });
    }

    const taskStatus = status || "pending";
    const taskPriority = priority || "medium";

    if (!allowedStatuses.includes(taskStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task status",
      });
    }

    if (!allowedPriorities.includes(taskPriority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task priority",
      });
    }

    const isCreatorMember = await checkWorkspaceMembership(workspace_id, userId);

    if (!isCreatorMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    if (assigned_to) {
      const isAssigneeMember = await checkWorkspaceMembership(
        workspace_id,
        assigned_to
      );

      if (!isAssigneeMember) {
        return res.status(400).json({
          success: false,
          message: "Assigned user must be a workspace member",
        });
      }
    }

    const [result] = await db.promise().query(
      `INSERT INTO tasks
        (workspace_id, assigned_to, created_by, title, description, status, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workspace_id,
        assigned_to || null,
        userId,
        title,
        description || null,
        taskStatus,
        taskPriority,
        due_date || null,
      ]
    );

    const [createdRows] = await db.promise().query(
      `SELECT
        t.task_id,
        t.workspace_id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        assigned.user_id AS assigned_to,
        assigned.name AS assigned_to_name,
        creator.user_id AS created_by,
        creator.name AS created_by_name
      FROM tasks t
      LEFT JOIN users assigned ON t.assigned_to = assigned.user_id
      INNER JOIN users creator ON t.created_by = creator.user_id
      WHERE t.task_id = ?`,
      [result.insertId]
    );

    const finalTask = createdRows[0] || {
      task_id: result.insertId,
      workspace_id,
      assigned_to: assigned_to || null,
      created_by: userId,
      title,
      description: description || null,
      status: taskStatus,
      priority: taskPriority,
      due_date: due_date || null,
    };

    if (finalTask.due_date) {
      const targetUserIds = new Set([userId]);
      if (finalTask.assigned_to) targetUserIds.add(Number(finalTask.assigned_to));
      targetUserIds.forEach((uid) => {
        syncTaskToCalendar(uid, finalTask).catch((err) =>
          console.warn(`[Calendar] Failed to sync task #${finalTask.task_id} for user ${uid}:`, err.message)
        );
      });
    }

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      task: finalTask,
    });
  } catch (error) {
    console.error("Create task error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while creating task",
    });
  }
};

/**
 * Create a task from a channel message or DM — with source attribution.
 * POST /api/tasks/create-from-message
 */
const createTaskFromMessage = async (req, res) => {
  try {
    const {
      workspace_id,
      title,
      description,
      assigned_to,
      priority,
      due_date,
      // Source info
      source_message_id,
      source_message_type, // 'channel' | 'dm'
      source_channel_id,    // set when type === 'channel'
      source_dm_user_id,    // set when type === 'dm'
    } = req.body;
    const userId = req.user.user_id;

    if (!workspace_id || !title) {
      return res.status(400).json({ success: false, message: "workspace_id and title are required" });
    }
    if (!source_message_id || !source_message_type) {
      return res.status(400).json({ success: false, message: "source_message_id and source_message_type are required" });
    }
    if (!["channel", "dm"].includes(source_message_type)) {
      return res.status(400).json({ success: false, message: "Invalid source_message_type" });
    }

    const taskPriority = allowedPriorities.includes(priority) ? priority : "medium";

    // 1. Verify workspace membership
    const isMember = await checkWorkspaceMembership(workspace_id, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, message: "You are not a member of this workspace" });
    }

    // 2. Verify access to the source message
    if (source_message_type === "channel") {
      if (!source_channel_id) {
        return res.status(400).json({ success: false, message: "source_channel_id required for channel messages" });
      }
      // Verify user is a member of the workspace that owns the channel
      const [channelRows] = await db.promise().query(
        `SELECT c.channel_id FROM channels c
         INNER JOIN workspace_members wm ON c.workspace_id = wm.workspace_id
         WHERE c.channel_id = ? AND wm.user_id = ?`,
        [source_channel_id, userId]
      );
      if (channelRows.length === 0) {
        return res.status(403).json({ success: false, message: "Not authorized to access this channel message" });
      }
      // Verify the message actually exists
      const [msgRows] = await db.promise().query(
        "SELECT message_id FROM messages WHERE message_id = ? AND channel_id = ? AND is_deleted = FALSE",
        [source_message_id, source_channel_id]
      );
      if (msgRows.length === 0) {
        return res.status(404).json({ success: false, message: "Source message not found" });
      }
    } else {
      // dm
      if (!source_dm_user_id) {
        return res.status(400).json({ success: false, message: "source_dm_user_id required for DM messages" });
      }
      // Verify the DM message is accessible by this user
      const [dmRows] = await db.promise().query(
        `SELECT dm.direct_message_id FROM direct_messages dm
         WHERE dm.direct_message_id = ?
           AND ((dm.sender_id = ? AND dm.receiver_id = ?) OR (dm.sender_id = ? AND dm.receiver_id = ?))
           AND dm.is_deleted = FALSE`,
        [source_message_id, userId, source_dm_user_id, source_dm_user_id, userId]
      );
      if (dmRows.length === 0) {
        return res.status(403).json({ success: false, message: "Not authorized to access this DM message" });
      }
    }

    // 3. Verify assignee is a workspace member (if provided)
    if (assigned_to) {
      const isAssigneeMember = await checkWorkspaceMembership(workspace_id, assigned_to);
      if (!isAssigneeMember) {
        return res.status(400).json({ success: false, message: "Assigned user must be a workspace member" });
      }
    }

    // 4. Insert task with source attribution
    const [result] = await db.promise().query(
      `INSERT INTO tasks
        (workspace_id, assigned_to, created_by, title, description, status, priority, due_date,
         source_message_id, source_message_type, source_channel_id, source_dm_user_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        workspace_id,
        assigned_to || null,
        userId,
        title,
        description || null,
        taskPriority,
        due_date || null,
        source_message_id,
        source_message_type,
        source_channel_id || null,
        source_dm_user_id || null,
      ]
    );

    const createdTask = {
      task_id: result.insertId,
      workspace_id,
      title,
      description: description || null,
      status: "pending",
      priority: taskPriority,
      due_date: due_date || null,
      assigned_to: assigned_to || null,
      created_by: userId,
      source_message_id,
      source_message_type,
      source_channel_id: source_channel_id || null,
      source_dm_user_id: source_dm_user_id || null,
    };

    if (createdTask.due_date) {
      const targetUserIds = new Set([userId]);
      if (createdTask.assigned_to) targetUserIds.add(Number(createdTask.assigned_to));
      targetUserIds.forEach((uid) => {
        syncTaskToCalendar(uid, createdTask).catch((err) =>
          console.warn(`[Calendar] Failed to sync task from msg #${createdTask.task_id}:`, err.message)
        );
      });
    }

    return res.status(201).json({
      success: true,
      message: "Task created from message",
      task: createdTask,
    });
  } catch (error) {
    console.error("createTaskFromMessage error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating task from message" });
  }
};

/**
 * Update a task's fields (title, description, priority, assignee, status).
 * PUT /api/tasks/update/:taskId
 */
const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, priority, assigned_to, status, due_date } = req.body;
    const userId = req.user.user_id;

    const [tasks] = await db.promise().query(
      "SELECT task_id, workspace_id FROM tasks WHERE task_id = ?",
      [taskId]
    );
    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const task = tasks[0];
    const isMember = await checkWorkspaceMembership(task.workspace_id, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, message: "You are not a member of this workspace" });
    }

    // Build SET clause dynamically
    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push("title = ?"); values.push(title.trim()); }
    if (description !== undefined) { updates.push("description = ?"); values.push(description ? description.trim() : null); }
    if (due_date !== undefined) { updates.push("due_date = ?"); values.push(due_date || null); }
    if (priority !== undefined) {
      if (!allowedPriorities.includes(priority)) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      updates.push("priority = ?"); values.push(priority);
    }
    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      updates.push("status = ?"); values.push(status);
    }
    if (assigned_to !== undefined) {
      if (assigned_to !== null && assigned_to !== '') {
        const isAssigneeMember = await checkWorkspaceMembership(task.workspace_id, assigned_to);
        if (!isAssigneeMember) {
          return res.status(400).json({ success: false, message: "Assigned user must be a workspace member" });
        }
        updates.push("assigned_to = ?"); values.push(Number(assigned_to));
      } else {
        updates.push("assigned_to = NULL");
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    values.push(taskId);
    await db.promise().query(`UPDATE tasks SET ${updates.join(", ")} WHERE task_id = ?`, values);

    // Fetch refreshed task to sync with Google Calendar
    try {
      const refreshedResult = await db.promise().query(
        "SELECT * FROM tasks WHERE task_id = ?",
        [taskId]
      );
      const refreshedRows = Array.isArray(refreshedResult)
        ? (Array.isArray(refreshedResult[0]) ? refreshedResult[0] : refreshedResult)
        : [];
      if (refreshedRows.length > 0) {
        const fullTask = refreshedRows[0];
        const targetUserIds = new Set([userId]);
        if (fullTask.assigned_to) targetUserIds.add(Number(fullTask.assigned_to));
        if (fullTask.created_by) targetUserIds.add(Number(fullTask.created_by));

        targetUserIds.forEach((uid) => {
          if (fullTask.due_date) {
            syncTaskToCalendar(uid, fullTask).catch((err) =>
              console.warn(`[Calendar] Failed to update calendar for task #${taskId}:`, err.message)
            );
          } else {
            deleteTaskFromCalendar(uid, taskId).catch((err) =>
              console.warn(`[Calendar] Failed to delete calendar event for task #${taskId}:`, err.message)
            );
          }
        });
      }
    } catch (syncErr) {
      console.warn("[Calendar] Error triggering calendar sync after update:", syncErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task: {
        task_id: Number(taskId),
        title,
        description,
        priority,
        status,
        due_date,
        assigned_to
      }
    });
  } catch (error) {
    console.error("updateTask error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating task" });
  }
};

const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.user_id;

    const [tasks] = await db.promise().query(
      "SELECT task_id, workspace_id, created_by, assigned_to FROM tasks WHERE task_id = ?",
      [taskId]
    );
    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const task = tasks[0];
    const isMember = await checkWorkspaceMembership(task.workspace_id, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, message: "You are not a member of this workspace" });
    }

    // Allow deletion if user is creator, assignee, or workspace owner/admin
    const [roles] = await db.promise().query(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [task.workspace_id, userId]
    );
    const userRole = roles[0]?.role;
    const canDelete =
      task.created_by === userId ||
      task.assigned_to === userId ||
      ["owner", "admin"].includes(userRole);

    if (!canDelete) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this task" });
    }

    await db.promise().query("DELETE FROM tasks WHERE task_id = ?", [taskId]);

    // Remove from Google Calendar
    try {
      const targetUserIds = new Set([userId]);
      if (task.assigned_to) targetUserIds.add(Number(task.assigned_to));
      if (task.created_by) targetUserIds.add(Number(task.created_by));
      targetUserIds.forEach((uid) => {
        deleteTaskFromCalendar(uid, taskId).catch((err) =>
          console.warn(`[Calendar] Failed to delete calendar event for task #${taskId}:`, err.message)
        );
      });
    } catch (calErr) {
      console.warn("[Calendar] Delete calendar sync error:", calErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      task_id: Number(taskId)
    });
  } catch (error) {
    console.error("Delete task error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while deleting task" });
  }
};

const getWorkspaceTasks = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.user_id;
    const { scope, assigned_to, created_by, status } = req.query;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
      });
    }

    const isMember = await checkWorkspaceMembership(workspaceId, userId);

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    let query = `
      SELECT
        t.task_id,
        t.workspace_id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        t.source_message_id,
        t.source_message_type,
        t.source_channel_id,
        t.source_dm_user_id,
        assigned.user_id AS assigned_to,
        assigned.name AS assigned_to_name,
        creator.user_id AS created_by,
        creator.name AS created_by_name
      FROM tasks t
      LEFT JOIN users assigned
        ON t.assigned_to = assigned.user_id
      INNER JOIN users creator
        ON t.created_by = creator.user_id
      WHERE t.workspace_id = ?
    `;

    const queryParams = [workspaceId];

    // Filter by scope / assigned_to
    if (scope === "assigned_to_me" || assigned_to === "me") {
      query += " AND t.assigned_to = ?";
      queryParams.push(userId);
    } else if (assigned_to && !isNaN(assigned_to)) {
      query += " AND t.assigned_to = ?";
      queryParams.push(Number(assigned_to));
    } else if (scope === "created_by_me" || created_by === "me") {
      query += " AND t.created_by = ?";
      queryParams.push(userId);
    } else if (created_by && !isNaN(created_by)) {
      query += " AND t.created_by = ?";
      queryParams.push(Number(created_by));
    }

    // Filter by status if provided
    if (status && allowedStatuses.includes(status)) {
      query += " AND t.status = ?";
      queryParams.push(status);
    }

    query += " ORDER BY t.created_at DESC";

    const [tasks] = await db.promise().query(query, queryParams);

    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error("Get tasks error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching tasks",
    });
  }
};

const updateTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;
    const userId = req.user.user_id;

    if (!taskId || !status) {
      return res.status(400).json({
        success: false,
        message: "Task ID and status are required",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task status",
      });
    }

    const [tasks] = await db.promise().query(
      "SELECT task_id, workspace_id FROM tasks WHERE task_id = ?",
      [taskId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    const task = tasks[0];
    const isMember = await checkWorkspaceMembership(task.workspace_id, userId);

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    await db
      .promise()
      .query("UPDATE tasks SET status = ? WHERE task_id = ?", [status, taskId]);

    return res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      task: {
        task_id: Number(taskId),
        status,
      },
    });
  } catch (error) {
    console.error("Update task status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while updating task status",
    });
  }
};

module.exports = {
  createTask,
  createTaskFromMessage,
  updateTask,
  deleteTask,
  getWorkspaceTasks,
  updateTaskStatus,
};

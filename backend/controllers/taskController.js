const db = require("../config/db");

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

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      task: {
        task_id: result.insertId,
        workspace_id,
        assigned_to: assigned_to || null,
        created_by: userId,
        title,
        description: description || null,
        status: taskStatus,
        priority: taskPriority,
        due_date: due_date || null,
      },
    });
  } catch (error) {
    console.error("Create task error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while creating task",
    });
  }
};

const getWorkspaceTasks = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.user_id;

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

    const [tasks] = await db.promise().query(
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
      LEFT JOIN users assigned
        ON t.assigned_to = assigned.user_id
      INNER JOIN users creator
        ON t.created_by = creator.user_id
      WHERE t.workspace_id = ?
      ORDER BY t.created_at DESC`,
      [workspaceId]
    );

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
  getWorkspaceTasks,
  updateTaskStatus,
};

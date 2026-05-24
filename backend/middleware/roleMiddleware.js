const db = require("../config/db");

const validRoles = ["owner", "admin", "member"];

const allowRoles = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      // authMiddleware must run before this middleware.
      if (!req.user || !req.user.user_id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Please login first",
        });
      }

      const workspaceId = req.body.workspace_id || req.params.workspaceId;

      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          message: "Workspace ID is required",
        });
      }

      const hasInvalidRole = allowedRoles.some(
        (role) => !validRoles.includes(role)
      );

      if (hasInvalidRole) {
        return res.status(500).json({
          success: false,
          message: "Invalid role configuration",
        });
      }

      // Find the logged-in user's role in this workspace.
      const [members] = await db.promise().query(
        "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
        [workspaceId, req.user.user_id]
      );

      if (members.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Forbidden. You are not a member of this workspace",
        });
      }

      const userRole = members[0].role;

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden. You do not have permission for this action",
        });
      }

      req.user.role = userRole;
      req.user.workspace_id = Number(workspaceId);

      next();
    } catch (error) {
      console.error("Role middleware error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Server error while checking user role",
      });
    }
  };
};

module.exports = allowRoles;

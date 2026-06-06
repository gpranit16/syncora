const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");

dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const channelRoutes = require("./routes/channelRoutes");
const messageRoutes = require("./routes/messageRoutes");
const taskRoutes = require("./routes/taskRoutes");
const directMessageRoutes = require("./routes/directMessageRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const unreadRoutes = require("./routes/unreadRoutes");
const fileRoutes = require("./routes/fileRoutes");
const searchRoutes = require("./routes/searchRoutes");
const authMiddleware = require("./middleware/authMiddleware");
const chatSocket = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : "*";
const corsOptions = {
  origin: corsOrigins,
  ...(corsOrigins === "*" ? {} : { credentials: true }),
};

// Express middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/direct-messages", directMessageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/unread", unreadRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/search", searchRoutes);

app.get("/api/protected", authMiddleware, (req, res) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route",
    user: req.user,
  });
});

// Socket.io setup
const io = new Server(server, {
  cors: corsOptions,
});

chatSocket(io);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smart Team Collaboration API is running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
  });
});

const startServer = async () => {
  try {
    await db.verifyConnection();

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup aborted because TiDB is unavailable");
    await db.close().catch(() => {});
    process.exit(1);
  }
};

let isShuttingDown = false;

const shutdown = (signal, restart = false) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully`);

  const finishShutdown = async () => {
    try {
      await db.close();
    } catch (error) {
      console.error("Failed to close the TiDB connection pool:", error.message);
    }

    if (restart) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(0);
  };

  if (server.listening) {
    server.close(finishShutdown);
  } else {
    void finishShutdown();
  }
};

process.once("SIGUSR2", () => shutdown("SIGUSR2", true));
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

void startServer();

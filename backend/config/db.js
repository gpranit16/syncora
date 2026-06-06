const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mysql = require("mysql2");

const backendRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });

const requiredEnvironmentVariables = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name]
);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing required database environment variables: ${missingEnvironmentVariables.join(
      ", "
    )}`
  );
}

const parsePositiveInteger = (value, fallback, name) => {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
};

const certificatePath = process.env.DB_SSL_CA_PATH
  ? path.resolve(backendRoot, process.env.DB_SSL_CA_PATH)
  : path.join(backendRoot, "isrgrootx1.pem");

let certificateAuthority;

try {
  certificateAuthority = fs.readFileSync(certificatePath);
} catch (error) {
  throw new Error(
    `Unable to read the TiDB TLS certificate at ${certificatePath}: ${error.message}`,
    { cause: error }
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parsePositiveInteger(process.env.DB_PORT, 4000, "DB_PORT"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: certificateAuthority,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: parsePositiveInteger(
    process.env.DB_CONNECTION_LIMIT,
    10,
    "DB_CONNECTION_LIMIT"
  ),
  queueLimit: 0,
  connectTimeout: parsePositiveInteger(
    process.env.DB_CONNECT_TIMEOUT_MS,
    10000,
    "DB_CONNECT_TIMEOUT_MS"
  ),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

const promisePool = pool.promise();

const getErrorDetails = (error) => ({
  message: error.message,
  code: error.code,
  errno: error.errno,
  sqlState: error.sqlState,
  fatal: error.fatal,
  address: error.address,
  port: error.port,
});

pool.on("connection", (connection) => {
  connection.on("error", (error) => {
    console.error(
      "TiDB pooled connection error:",
      getErrorDetails(error)
    );
  });
});

/*
 * Preserve the existing db.promise() API while using a pool. A wrapper that
 * starts a transaction keeps one dedicated pooled connection until commit or
 * rollback; ordinary queries continue to use the shared promise pool.
 */
const createPromiseClient = () => {
  let transactionConnection;

  const getClient = () => transactionConnection || promisePool;

  return {
    query: (...args) => getClient().query(...args),
    execute: (...args) => getClient().execute(...args),
    beginTransaction: async () => {
      if (transactionConnection) {
        throw new Error("A database transaction is already active");
      }

      const connection = await promisePool.getConnection();

      try {
        await connection.beginTransaction();
        transactionConnection = connection;
      } catch (error) {
        connection.release();
        throw error;
      }
    },
    commit: async () => {
      if (!transactionConnection) {
        throw new Error("No active database transaction to commit");
      }

      const connection = transactionConnection;
      transactionConnection = undefined;

      try {
        await connection.commit();
      } finally {
        connection.release();
      }
    },
    rollback: async () => {
      if (!transactionConnection) {
        return;
      }

      const connection = transactionConnection;
      transactionConnection = undefined;

      try {
        await connection.rollback();
      } finally {
        connection.release();
      }
    },
  };
};

pool.promise = createPromiseClient;

pool.verifyConnection = async () => {
  let connection;

  try {
    connection = await promisePool.getConnection();
    await connection.query("SELECT 1");
    console.log(
      `TiDB connected successfully at ${process.env.DB_HOST}:${process.env.DB_PORT || 4000}`
    );
  } catch (error) {
    console.error(
      "TiDB connection verification failed:",
      getErrorDetails(error)
    );
    throw error;
  } finally {
    connection?.release();
  }
};

pool.close = () => promisePool.end();

module.exports = pool;

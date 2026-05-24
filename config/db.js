const path = require("path");
const { createRequire } = require("module");

const backendRequire = createRequire(path.join(__dirname, "../backend/package.json"));
const dotenv = backendRequire("dotenv");
const mysql = backendRequire("mysql2");

dotenv.config({ path: path.join(__dirname, "../backend/.env") });

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((error) => {
  if (error) {
    console.error("MySQL connection failed:", error.message);
    return;
  }

  console.log("MySQL connected successfully");
});

module.exports = db;

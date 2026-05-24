const dotenv = require("dotenv");
const mysql = require("mysql2");

dotenv.config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((error) => {
  if (error) {
    console.error("Database connection failed:", error.message);
    return;
  }

  console.log("Database connected successfully");
});

module.exports = db;

// backend/db.js
const { Pool } = require("pg");
const { db } = require("./config");

const pool = new Pool(db);

pool.on("connect", () => {
  console.log("✅ PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL error", err);
});

module.exports = pool;

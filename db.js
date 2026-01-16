const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./games.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registered_users (
      user_id TEXT,
      guild_id TEXT,
      username TEXT,
      registered_at INTEGER,
      PRIMARY KEY (user_id, guild_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      guild_id TEXT,
      username TEXT,
      game TEXT,
      start_time INTEGER,
      end_time INTEGER,
      duration_seconds INTEGER
    )
  `);

  // ✅ stores allowed role per server
  db.run(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      allowed_role_id TEXT
    )
  `);
});

module.exports = db;

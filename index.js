require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const db = require("./db");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
});

const activeSessions = new Map();

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function isRegistered(userId, guildId) {
  return new Promise((resolve) => {
    db.get(
      `SELECT user_id FROM registered_users WHERE user_id = ? AND guild_id = ?`,
      [userId, guildId],
      (err, row) => resolve(!!row)
    );
  });
}

function getAllowedRoleId(guildId) {
  return new Promise((resolve) => {
    db.get(
      `SELECT allowed_role_id FROM guild_settings WHERE guild_id = ?`,
      [guildId],
      (err, row) => resolve(row?.allowed_role_id || null)
    );
  });
}

function setAllowedRoleId(guildId, roleId) {
  return new Promise((resolve) => {
    db.run(
      `INSERT OR REPLACE INTO guild_settings (guild_id, allowed_role_id)
       VALUES (?, ?)`,
      [guildId, roleId],
      () => resolve(true)
    );
  });
}

function removeAllowedRoleId(guildId) {
  return new Promise((resolve) => {
    db.run(
      `DELETE FROM guild_settings WHERE guild_id = ?`,
      [guildId],
      () => resolve(true)
    );
  });
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 🎮 Track games
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  const user = newPresence.user;
  const guild = newPresence.guild;
  if (!user || !guild) return;

  const guildId = guild.id;
  const userId = user.id;
  const key = `${guildId}:${userId}`;

  const registered = await isRegistered(userId, guildId);
  if (!registered) return;

  const oldGame = oldPresence?.activities?.find(a => a.type === 0)?.name;
  const newGame = newPresence.activities?.find(a => a.type === 0)?.name;

  if (!oldGame && newGame) {
    activeSessions.set(key, { game: newGame, start: Date.now() });
  }

  if (oldGame && !newGame) {
    const session = activeSessions.get(key);
    if (!session) return;

    const end = Date.now();
    const dur = Math.floor((end - session.start) / 1000);

    db.run(
      `INSERT INTO sessions (user_id, guild_id, username, game, start_time, end_time, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, guildId, user.username, session.game, session.start, end, dur]
    );

    activeSessions.delete(key);
  }

  if (oldGame && newGame && oldGame !== newGame) {
    const session = activeSessions.get(key);

    if (session) {
      const end = Date.now();
      const dur = Math.floor((end - session.start) / 1000);

      db.run(
        `INSERT INTO sessions (user_id, guild_id, username, game, start_time, end_time, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, guildId, user.username, session.game, session.start, end, dur]
      );
    }

    activeSessions.set(key, { game: newGame, start: Date.now() });
  }
});

// Slash commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: "❌ Use inside a server.", ephemeral: true });

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const guildId = interaction.guild.id;

  // ✅ /setrole
  if (interaction.commandName === "setrole") {
    const role = interaction.options.getRole("role", true);
    await setAllowedRoleId(guildId, role.id);

    return interaction.reply(`✅ Allowed role set to: ${role}.\nNow only this role can use /register`);
  }

  // ✅ /getrole
  if (interaction.commandName === "getrole") {
    const roleId = await getAllowedRoleId(guildId);
    if (!roleId) return interaction.reply("✅ No role restriction set. Everyone can register.");

    return interaction.reply(`✅ Only this role can register: <@&${roleId}>`);
  }

  // ✅ /removerole
  if (interaction.commandName === "removerole") {
    await removeAllowedRoleId(guildId);
    return interaction.reply("✅ Role restriction removed. Everyone can register now.");
  }

  // ✅ /register (role restricted)
  if (interaction.commandName === "register") {
    const allowedRoleId = await getAllowedRoleId(guildId);

    if (allowedRoleId) {
      const member = interaction.member;
      const ok = member?.roles?.cache?.has(allowedRoleId);

      if (!ok) {
        return interaction.reply({
          content: `❌ You need role <@&${allowedRoleId}> to register.`,
          ephemeral: true
        });
      }
    }

    db.run(
      `INSERT OR REPLACE INTO registered_users (user_id, guild_id, username, registered_at)
       VALUES (?, ?, ?, ?)`,
      [userId, guildId, username, Date.now()]
    );

    return interaction.reply(`✅ Registered in **${interaction.guild.name}**! Tracking enabled 🎮`);
  }

  // /unregister
  if (interaction.commandName === "unregister") {
    db.run(
      `DELETE FROM registered_users WHERE user_id = ? AND guild_id = ?`,
      [userId, guildId]
    );

    return interaction.reply(`🛑 Unregistered from **${interaction.guild.name}**.`);
  }

  // defer heavy replies
  if (["played", "stats", "top", "last", "leaderboard"].includes(interaction.commandName)) {
    await interaction.deferReply();
  }

  const registered = await isRegistered(userId, guildId);
  if (!registered) return interaction.editReply(`❌ You are not registered.\nUse /register.`);

  // /played
  if (interaction.commandName === "played") {
    db.all(
      `SELECT game, COUNT(*) as sessions, SUM(duration_seconds) as total
       FROM sessions
       WHERE user_id = ? AND guild_id = ?
       GROUP BY game
       ORDER BY total DESC`,
      [userId, guildId],
      (err, rows) => {
        if (!rows || rows.length === 0) return interaction.editReply("No games tracked yet 😅");

        let msg = `**🎮 Games played by ${username}:**\n`;
        rows.slice(0, 20).forEach((r, i) => {
          msg += `${i + 1}. **${r.game}** — ${formatDuration(r.total)} (${r.sessions} sessions)\n`;
        });

        interaction.editReply(msg);
      }
    );
  }

  // /stats
  if (interaction.commandName === "stats") {
    db.get(
      `SELECT COUNT(*) as sessions, SUM(duration_seconds) as total
       FROM sessions WHERE user_id = ? AND guild_id = ?`,
      [userId, guildId],
      (err, row) => {
        if (!row || row.sessions === 0) return interaction.editReply("No stats yet 😅");

        interaction.editReply(
          `📊 **Your Stats**\n🎮 Sessions: **${row.sessions}**\n⏱️ Playtime: **${formatDuration(row.total)}**`
        );
      }
    );
  }

  // /top
  if (interaction.commandName === "top") {
    db.all(
      `SELECT game, SUM(duration_seconds) as total
       FROM sessions WHERE user_id = ? AND guild_id = ?
       GROUP BY game ORDER BY total DESC LIMIT 5`,
      [userId, guildId],
      (err, rows) => {
        if (!rows || rows.length === 0) return interaction.editReply("No games yet 😅");

        let msg = `🏆 **Top Games**\n`;
        rows.forEach((r, i) => {
          msg += `${i + 1}. **${r.game}** — **${formatDuration(r.total)}**\n`;
        });

        interaction.editReply(msg);
      }
    );
  }

  // /last
  if (interaction.commandName === "last") {
    db.get(
      `SELECT game, duration_seconds
       FROM sessions WHERE user_id = ? AND guild_id = ?
       ORDER BY end_time DESC LIMIT 1`,
      [userId, guildId],
      (err, row) => {
        if (!row) return interaction.editReply("No sessions yet 😅");

        interaction.editReply(`🕹️ Last Played: **${row.game}** — **${formatDuration(row.duration_seconds)}**`);
      }
    );
  }

  // /leaderboard
  if (interaction.commandName === "leaderboard") {
    db.all(
      `SELECT username, SUM(duration_seconds) as total
       FROM sessions WHERE guild_id = ?
       GROUP BY user_id ORDER BY total DESC LIMIT 10`,
      [guildId],
      (err, rows) => {
        if (!rows || rows.length === 0) return interaction.editReply("No leaderboard data yet 😅");

        let msg = `🏅 **Leaderboard (${interaction.guild.name})**\n`;
        rows.forEach((r, i) => {
          msg += `${i + 1}. **${r.username}** — **${formatDuration(r.total)}**\n`;
        });

        interaction.editReply(msg);
      }
    );
  }
});

client.login(process.env.TOKEN);

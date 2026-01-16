const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
require("dotenv").config();

const commands = [
  new SlashCommandBuilder().setName("register").setDescription("Register yourself for game tracking"),
  new SlashCommandBuilder().setName("unregister").setDescription("Stop tracking your games"),

  new SlashCommandBuilder().setName("played").setDescription("List games you played"),
  new SlashCommandBuilder().setName("stats").setDescription("Your overall stats"),
  new SlashCommandBuilder().setName("top").setDescription("Top played games"),
  new SlashCommandBuilder().setName("last").setDescription("Last played session"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top users in this server by playtime"),

  // ✅ admin role setting
  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("Set which role can register")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(opt =>
      opt.setName("role").setDescription("Role allowed to register").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("getrole")
    .setDescription("Show which role is allowed to register"),

  new SlashCommandBuilder()
    .setName("removerole")
    .setDescription("Remove role restriction (everyone can register)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("⏳ Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error(err);
  }
})();

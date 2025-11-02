const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');

require('dotenv').config();

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;

if (!clientId || !guildId || !token) {
  console.error('Please set DISCORD_TOKEN, CLIENT_ID and GUILD_ID in environment (or .env)');
  process.exit(1);
}

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const cmd = require(`./commands/${file}`);
  if (cmd.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands to guild ${guildId}`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Commands registered.');
  } catch (err) {
    console.error('Failed to register commands', err);
  }
})();

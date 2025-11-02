const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate a player')
    .addUserOption(opt => opt.setName('player').setDescription('The player to rate').setRequired(true)),
  async execute(interaction) {
    // main interaction flow is handled in index.js (UI interactions). This file only registers the slash command.
  await interaction.deferReply({ flags: 64 });
    // index.js will continue by sending select menu; small acknowledgment here.
    await interaction.editReply({ content: 'Preparing rating UI...' });
  }
};

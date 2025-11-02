const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myratings')
    .setDescription("View a player's ratings")
    .addUserOption(opt => opt.setName('player').setDescription('Player to view').setRequired(false)),
  async execute(interaction) {
    // handled centrally in index.js for consistent formatting
  await interaction.deferReply({ flags: 64 });
  await interaction.editReply('Fetching ratings...');
  }
};

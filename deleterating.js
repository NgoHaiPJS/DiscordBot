const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deleterating')
    .setDescription('Delete all ratings for a player (admins only)')
    .addUserOption(opt => opt.setName('player').setDescription('Player to delete ratings for').setRequired(true)),
  async execute(interaction) {
    // handled in main script
  }
};

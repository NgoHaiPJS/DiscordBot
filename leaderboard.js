const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the ratings leaderboard'),
  async execute(interaction) {
  await interaction.deferReply({ flags: 64 });
  await interaction.editReply('Preparing leaderboard...');
  }
};

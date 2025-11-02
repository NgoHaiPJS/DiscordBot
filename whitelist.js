const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const WHITELIST_PATH = path.join(__dirname, '..', 'data', 'whitelist.json');
function readWhitelist() {
  try { return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8')); } catch { return { roles: [], users: [] }; }
}
function writeWhitelist(obj) { fs.writeFileSync(WHITELIST_PATH, JSON.stringify(obj, null, 2), 'utf8'); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage rating whitelist (admins only)')
  .addSubcommand(sc => sc.setName('add').setDescription('Add a role or user to the rating whitelist').addRoleOption(o => o.setName('role').setDescription('Role to allow')).addUserOption(u => u.setName('user').setDescription('User to allow')))
  .addSubcommand(sc => sc.setName('remove').setDescription('Remove a role or user from the rating whitelist').addRoleOption(o => o.setName('role').setDescription('Role to remove')).addUserOption(u => u.setName('user').setDescription('User to remove')))
  .addSubcommand(sc => sc.setName('list').setDescription('List whitelisted roles and users'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Only admins allowed (set by default perms), but double-check
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Only server Administrators can manage the whitelist.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();
    const wl = readWhitelist();

    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      const user = interaction.options.getUser('user');
      if (!role && !user) return interaction.reply({ content: 'Please provide a role or a user to add.', flags: 64 });
      if (role && user) return interaction.reply({ content: 'Please provide only one of role or user.', flags: 64 });
      if (role) {
        if (!wl.roles) wl.roles = [];
        if (wl.roles.includes(role.id)) return interaction.reply({ content: `${role.name} is already whitelisted.`, flags: 64 });
        wl.roles.push(role.id);
        writeWhitelist(wl);
        return interaction.reply({ content: `Added ${role.name} to the rating whitelist.`, flags: 64 });
      }
      if (user) {
        if (!wl.users) wl.users = [];
        if (wl.users.includes(user.id)) return interaction.reply({ content: `${user.tag} is already whitelisted.`, flags: 64 });
        wl.users.push(user.id);
        writeWhitelist(wl);
        return interaction.reply({ content: `Added ${user.tag} to the rating whitelist.`, flags: 64 });
      }
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      const user = interaction.options.getUser('user');
      if (!role && !user) return interaction.reply({ content: 'Please provide a role or a user to remove.', flags: 64 });
      if (role && user) return interaction.reply({ content: 'Please provide only one of role or user.', flags: 64 });
      if (role) {
        if (!wl.roles) wl.roles = [];
        if (!wl.roles.includes(role.id)) return interaction.reply({ content: `${role.name} was not in the whitelist.`, flags: 64 });
        wl.roles = wl.roles.filter(r => r !== role.id);
        writeWhitelist(wl);
        return interaction.reply({ content: `Removed ${role.name} from the rating whitelist.`, flags: 64 });
      }
      if (user) {
        if (!wl.users) wl.users = [];
        if (!wl.users.includes(user.id)) return interaction.reply({ content: `${user.tag} was not in the whitelist.`, flags: 64 });
        wl.users = wl.users.filter(u => u !== user.id);
        writeWhitelist(wl);
        return interaction.reply({ content: `Removed ${user.tag} from the rating whitelist.`, flags: 64 });
      }
    }

    if (sub === 'list') {
      const roleList = (wl.roles || []).map(id => `<@&${id}>`).join('\n');
      const userList = (wl.users || []).map(id => `<@${id}>`).join('\n');
      if ((!wl.roles || wl.roles.length === 0) && (!wl.users || wl.users.length === 0)) return interaction.reply({ content: 'No roles or users are whitelisted.', flags: 64 });
      let out = 'Whitelisted entries:\n';
      if (roleList) out += `\nRoles:\n${roleList}`;
      if (userList) out += `\nUsers:\n${userList}`;
      return interaction.reply({ content: out, flags: 64 });
    }
  }
};

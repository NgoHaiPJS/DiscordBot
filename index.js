const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const LEGACY_RATER_ROLE_ID = process.env.RATER_ROLE_ID || null;
const DISABLE_LEGACY_RATER = (process.env.DISABLE_LEGACY_RATER || 'false').toLowerCase() === 'true';

const WHITELIST_PATH = path.join(__dirname, 'data', 'whitelist.json');
function readWhitelist() {
  try { return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8')); } catch { return { roles: [], users: [] }; }
}
function writeWhitelist(obj) { fs.writeFileSync(WHITELIST_PATH, JSON.stringify(obj, null, 2), 'utf8'); }

if (!TOKEN) {
  console.error('Please set DISCORD_TOKEN in environment (.env)');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.data) client.commands.set(cmd.data.name, cmd);
}

const DATA_PATH = path.join(__dirname, 'data', 'ratings.json');
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const sessions = new Map();
const pagerSessions = new Map();

let _readyHandled = false;
function _onReady() {
  if (_readyHandled) return;
  _readyHandled = true;
  console.log(`Logged in as ${client.user.tag}`);
}

client.once('clientReady', _onReady);
setTimeout(() => {
  if (!_readyHandled) client.once('ready', _onReady);
}, 2000);

function makeRatingSelect(idPrefix, sessionKey, attrName, placeholder = 'Select 1-10') {
  const session = sessions.get(sessionKey);
  let display = placeholder;
  if (session && session.attributes && session.attributes[attrName]?.rating) {
    display = `${session.attributes[attrName].rating}/10`;
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${idPrefix}:${sessionKey}:${attrName}`)
      .setPlaceholder(`${attrName} — ${display}`)
      .addOptions(
        Array.from({ length: 10 }, (_, i) => ({
          label: `${i + 1}`,
          value: `${i + 1}`
        }))
      )
  );
}


function createRatingEmbed(entry, client) {
  const color = entry.totalPercent >= 80 ? 0x22c55e : entry.totalPercent >= 60 ? 0xfbbf24 : 0xef4444;
  const embed = new EmbedBuilder()
    .setTitle(`Rating for ${entry.targetName}`)
    .setColor(color)
    .setTimestamp(new Date(entry.timestamp))
    .setAuthor({ name: `Rated by ${entry.raterTag}`, iconURL: entry.raterAvatarURL })
    .setThumbnail(entry.targetAvatarURL);

  embed.addFields({ name: 'Total Score', value: `${entry.totalPercent}/100`, inline: true });
  
  // Fix: Show "Field" for field players and position for keepers
  if (entry.type === 'keeper') {
    embed.addFields({ name: 'Type', value: 'Field', inline: true });
    embed.addFields({ name: 'Position', value: 'Goalkeeper', inline: true });
  } else {
    embed.addFields({ name: 'Type', value: 'Field', inline: true });
    if (entry.positionSpecific && entry.positionSpecific.length > 0) {
      const positions = Array.isArray(entry.positionSpecific) ? entry.positionSpecific.join(', ') : entry.positionSpecific;
      embed.addFields({ name: 'Position', value: positions, inline: true });
    }
  }

  for (const [attr, data] of Object.entries(entry.attributes || {})) {
    const val = `${data.rating}/10${data.comment ? ` — ${data.comment}` : ''}`;
    embed.addFields({ name: attr, value: val, inline: true });
  }

  return embed;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
function scheduleSessionTimeout(sessionKey) {
  const s = sessions.get(sessionKey);
  if (!s) return;
  if (s._timeoutId) clearTimeout(s._timeoutId);
  s._timeoutId = setTimeout(() => {
    const cur = sessions.get(sessionKey);
    if (!cur || cur.persistent) return;
    sessions.delete(sessionKey);
    console.info(`[session-timeout] cleaned session ${sessionKey}`);
  }, SESSION_TIMEOUT_MS);
}

function clearSessionTimeout(sessionKey) {
  const s = sessions.get(sessionKey);
  if (!s) return;
  if (s._timeoutId) {
    clearTimeout(s._timeoutId);
    delete s._timeoutId;
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleStringSelect(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (err) {
    console.error('Interaction handler error', err);
    const reply = { content: `An error occurred: ${err.message}`, flags: 64, components: [] };
    if (interaction.replied || interaction.deferred) {
      try { await interaction.editReply(reply); } catch {}
    } else {
      try { await interaction.reply(reply); } catch {}
    }
  }
});

async function handleCommand(interaction) {
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  if (interaction.commandName === 'rate') {
    let member = interaction.member;
    if (!member || !member.roles || !member.roles.cache) {
      if (!interaction.guild) return interaction.reply({ content: "You don't have permission to use /rate.", flags: 64 });
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    }

    let isAdmin = false;
    try {
      if (interaction.guild && interaction.guild.ownerId === interaction.user.id) isAdmin = true;
      if (!isAdmin && interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) isAdmin = true;
      if (!isAdmin && member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) isAdmin = true;
    } catch (e) {
      isAdmin = false;
    }

    const wl = readWhitelist();
    const hasWhitelistRole = member && member.roles && member.roles.cache && Array.isArray(wl.roles) && wl.roles.some(rid => member.roles.cache.has(rid));
    const hasWhitelistUser = Array.isArray(wl.users) && wl.users.includes(interaction.user.id);
    const whitelistEmpty = (!wl.roles || wl.roles.length === 0) && (!wl.users || wl.users.length === 0);
    const hasLegacyRole = !DISABLE_LEGACY_RATER && whitelistEmpty && member && member.roles && member.roles.cache && LEGACY_RATER_ROLE_ID && member.roles.cache.has(LEGACY_RATER_ROLE_ID);

    if (!isAdmin && !hasWhitelistRole && !hasWhitelistUser && !hasLegacyRole) {
      try {
        const roleIds = member && member.roles && member.roles.cache ? Array.from(member.roles.cache.keys()) : [];
        console.info(`[perm-check] user=${interaction.user.id} isAdmin=${isAdmin} hasWhitelistRole=${hasWhitelistRole} hasWhitelistUser=${hasWhitelistUser} hasLegacyRole=${hasLegacyRole} memberRoles=${JSON.stringify(roleIds)} whitelistRoles=${JSON.stringify(wl.roles)} whitelistUsers=${JSON.stringify(wl.users)}`);
      } catch (e) {}
      return interaction.reply({ content: "You don't have permission to use /rate.", flags: 64 });
    }

    const target = interaction.options.getUser('player');
    if (!target) return interaction.reply({ content: 'Please specify a player to rate.', flags: 64 });

    const sessionKey = `${interaction.user.id}:${Date.now()}`;
    sessions.set(sessionKey, {
      raterId: interaction.user.id,
      raterTag: interaction.user.tag,
      raterAvatarURL: interaction.user.displayAvatarURL(),
      targetId: target.id,
      targetTag: target.tag,
      targetAvatarURL: target.displayAvatarURL(),
      channelId: interaction.channelId,
      messageId: null,
      attributes: {},
      positionSpecific: [],
      type: null,
      persistent: false
    });
    scheduleSessionTimeout(sessionKey);

    const roleSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`select_role:${sessionKey}`)
        .setPlaceholder('Choose player type')
        .addOptions([
          { label: 'Field Player', value: 'field' },
          { label: 'Goalkeeper', value: 'keeper' }
        ])
    );
    const cancelBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    
    const reply = await interaction.reply({ 
      content: `Rating ${target.tag} — choose player type:`, 
      components: [roleSelect, cancelBtn], 
      flags: 64,
      fetchReply: true 
    });
    
    sessions.get(sessionKey).messageId = reply.id;
    return;
  }

  if (interaction.commandName === 'myratings') {
    const target = interaction.options.getUser('player') || interaction.user;
    const data = readData();
    const ratings = data.filter(r => r.targetId === target.id).sort((a, b) => b.timestamp - a.timestamp);
    if (ratings.length === 0) return interaction.reply({ content: `${target.tag} has no ratings yet.`, flags: 64 });

    const embeds = ratings.slice(0, 100).map(r => createRatingEmbed(r, client));
    const sessionKey = `${interaction.user.id}:pager:${Date.now()}`;
    pagerSessions.set(sessionKey, { userId: interaction.user.id, embeds, index: 0, type: 'myratings' });

    const prev = new ButtonBuilder().setCustomId(`pager:myratings:${sessionKey}:prev`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true);
    const next = new ButtonBuilder().setCustomId(`pager:myratings:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(embeds.length <= 1);
    await interaction.reply({ embeds: [embeds[0]], components: [new ActionRowBuilder().addComponents(prev, next)], flags: 64 });
    return;
  }

  if (interaction.commandName === 'leaderboard') {
    const data = readData();
    if (data.length === 0) return interaction.reply({ content: 'No ratings yet.', flags: 64 });
    
    const map = new Map();
    for (const r of data) {
      const existing = map.get(r.targetId);
      if (!existing || r.totalPercent > existing.best) {
        map.set(r.targetId, { best: r.totalPercent, name: r.targetName });
      }
    }
    
    const leaderboard = Array.from(map.entries()).map(([id, v]) => ({ id, score: v.best, name: v.name }));
    leaderboard.sort((a, b) => b.score - a.score);

    const pages = [];
    for (let i = 0; i < leaderboard.length; i += 10) {
      const chunk = leaderboard.slice(i, i + 10);
      const embed = new EmbedBuilder().setTitle('🏆 Project Egoist Tryout Leaderboard').setColor(0x2563eb).setTimestamp();
      let desc = '';
      for (let j = 0; j < chunk.length; j++) {
        const idx = i + j + 1;
        const row = chunk[j];
        desc += `**#${idx}** <@${row.id}> — **${Math.round(row.score)}/100**\n`;
      }
      embed.setDescription(desc);
      pages.push(embed);
    }

    const sessionKey = `${interaction.user.id}:pager:leaderboard:${Date.now()}`;
    pagerSessions.set(sessionKey, { userId: interaction.user.id, embeds: pages, index: 0, type: 'leaderboard' });
    const prev = new ButtonBuilder().setCustomId(`pager:leaderboard:${sessionKey}:prev`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true);
    const next = new ButtonBuilder().setCustomId(`pager:leaderboard:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(pages.length <= 1);
    return interaction.reply({ embeds: [pages[0]], components: [new ActionRowBuilder().addComponents(prev, next)] });
  }

  if (interaction.commandName === 'deleterating') {
    const wl = readWhitelist();
    const member = interaction.member;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const hasWhitelistRole = member?.roles?.cache && wl.roles.some(rid => member.roles.cache.has(rid));
    const hasWhitelistUser = wl.users.includes(interaction.user.id);

    if (!isAdmin && !hasWhitelistRole && !hasWhitelistUser) {
      return interaction.reply({ content: "You don't have permission to delete ratings.", flags: 64 });
    }

    const target = interaction.options.getUser('player');
    if (!target) return interaction.reply({ content: 'Please specify a player.', flags: 64 });

    let data = readData();
    const before = data.length;
    data = data.filter(r => r.targetId !== target.id);
    writeData(data);

    return interaction.reply({ content: `Deleted ${before - data.length} ratings for ${target.tag}.`, flags: 64 });
  }

  await cmd.execute(interaction);
}


async function handleStringSelect(interaction) {
  const expiredMessage = { content: 'This rating session has expired or is invalid. Please start a new one with /rate.', components: [], flags: 64 };

  if (interaction.customId.startsWith('select_role:')) {
    const sessionKey = interaction.customId.substring('select_role:'.length);
    const session = sessions.get(sessionKey);
    if (!session) return interaction.update(expiredMessage);

    session.type = interaction.values[0];
    const attributes = session.type === 'keeper'
      ? ['Reflex', 'Positioning', 'Handling', 'Diving', 'Passing']
      : ['Shooting', 'Dribbling', 'Defense', 'Passing', 'Vision'];
    session.attrOrder = attributes;
    session.currentAttrIndex = 0;
    session.attributes = {};

    const currentAttr = attributes[0];
    const rows = [
      makeRatingSelect('rating', sessionKey, currentAttr),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comment:${sessionKey}:${currentAttr}`).setLabel('Add Comment').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:back`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      )
    ];

    return interaction.update({
      content: `Rating ${session.targetTag} (${session.type === 'keeper' ? 'Goalkeeper' : 'Field Player'}) — Rate **${currentAttr}** (1-10):`,
      components: rows
    });

  } else if (interaction.customId.startsWith('rating:')) {
    const parts = interaction.customId.split(':');
    const attrName = parts.pop();
    parts.shift();
    const sessionKey = parts.join(':');
    const session = sessions.get(sessionKey);
    if (!session || session.raterId !== interaction.user.id) return interaction.update(expiredMessage);

    const val = interaction.values[0];
    session.attributes[attrName] = session.attributes[attrName] || {};
    session.attributes[attrName].rating = parseInt(val, 10);
    session.persistent = true;
    clearSessionTimeout(sessionKey);

    // Stay on this attribute until user presses Next
    const currentIndex = session.currentAttrIndex || 0;
    const currentAttr = session.attrOrder[currentIndex];

    const rows = [
      makeRatingSelect('rating', sessionKey, currentAttr),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comment:${sessionKey}:${currentAttr}`).setLabel('Add Comment').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:back`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(currentIndex === 0),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      )
    ];

    return interaction.update({
      content: `Saved rating for **${attrName}**: ${val}/10. Use Next/Back to navigate.`,
      components: rows
    });

  } else if (interaction.customId.startsWith('position_specific:')) {
    const sessionKey = interaction.customId.substring('position_specific:'.length);
    const session = sessions.get(sessionKey);
    if (!session) return interaction.update(expiredMessage);

    session.positionSpecific = interaction.values;
    const expectedAttrs = session.attrOrder || [];
    const summaryFields = expectedAttrs.map(a => `**${a}:** ${session.attributes[a]?.rating ?? '—'}`);
    const summary = summaryFields.join('\n') + `\n**Position(s):** ${session.positionSpecific.join(', ')}`;

    const submitRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`submit:${sessionKey}`).setLabel('Submit Rating').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );

    return interaction.update({ content: `Review your ratings:\n\n${summary}`, components: [submitRow] });
  }
}


async function handleButton(interaction) {
  const expiredMessage = { content: 'This rating session has expired or is invalid. Please start a new one with /rate.', components: [], flags: 64 };

  if (interaction.customId.startsWith('pager:')) {
    const parts = interaction.customId.split(':');
    const pageType = parts[1];
    const dir = parts.pop();
    const sessionKey = parts.slice(2).join(':');
    const session = pagerSessions.get(sessionKey);
    if (!session) return interaction.reply({ content: 'This page has expired.', flags: 64 });

    const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
    if (interaction.user.id !== session.userId && !isAdmin) return interaction.reply({ content: 'You cannot control this pagination.', flags: 64 });

    if (dir === 'next') session.index = Math.min(session.index + 1, session.embeds.length - 1);
    if (dir === 'prev') session.index = Math.max(session.index - 1, 0);
    const embed = session.embeds[session.index];
    const prevBtn = new ButtonBuilder().setCustomId(`pager:${pageType}:${sessionKey}:prev`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(session.index === 0);
    const nextBtn = new ButtonBuilder().setCustomId(`pager:${pageType}:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(session.index === session.embeds.length - 1);
    return interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(prevBtn, nextBtn)] });

  } else if (interaction.customId.startsWith('cancel:')) {
    const sessionKey = interaction.customId.substring('cancel:'.length);
    sessions.delete(sessionKey);
    return interaction.update({ content: 'Rating cancelled.', components: [] });

  } else if (interaction.customId.startsWith('comment:')) {
    const parts = interaction.customId.split(':');
    const attr = parts.pop();
    parts.shift();
    const sessionKey = parts.join(':');
    const session = sessions.get(sessionKey);
    if (!session) return interaction.reply(expiredMessage);

    const modal = new ModalBuilder().setCustomId(`modal_comment:${sessionKey}:${attr}`).setTitle(`Comment — ${attr}`);
    const currentComment = session.attributes[attr]?.comment || '';
    const input = new TextInputBuilder().setCustomId('comment_input').setLabel(`Optional comment for ${attr}`).setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(currentComment);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);

  } else if (interaction.customId.startsWith('nav:')) {
    const parts = interaction.customId.split(':');
    const dir = parts.pop();
    parts.shift();
    const sessionKey = parts.join(':');
    const session = sessions.get(sessionKey);
    if (!session) return interaction.update(expiredMessage);

    if (dir === 'next') session.currentAttrIndex++;
    if (dir === 'back') session.currentAttrIndex--;

    // If finished all attributes, show review/submit
    if (session.currentAttrIndex >= session.attrOrder.length) {
      const expectedAttrs = session.attrOrder;
      const summaryFields = expectedAttrs.map(a => `**${a}:** ${session.attributes[a]?.rating ?? '—'}`);
      let summary = summaryFields.join('\n');
      if (session.type === 'field' && session.positionSpecific?.length) {
        summary += `\n**Position(s):** ${session.positionSpecific.join(', ')}`;
      }
      const submitRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`submit:${sessionKey}`).setLabel('Submit Rating').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );
      return interaction.update({ content: `Review your ratings:\n\n${summary}`, components: [submitRow] });
    }

    const currentAttr = session.attrOrder[session.currentAttrIndex];
    const rows = [
      makeRatingSelect('rating', sessionKey, currentAttr),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comment:${sessionKey}:${currentAttr}`).setLabel('Add Comment').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:back`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(session.currentAttrIndex === 0),
        new ButtonBuilder().setCustomId(`nav:${sessionKey}:next`).setLabel('Next ▶').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      )
    ];
    return interaction.update({ content: `Rate **${currentAttr}** (1-10):`, components: rows });

  } else if (interaction.customId.startsWith('submit:')) {
    const sessionKey = interaction.customId.substring('submit:'.length);
    const session = sessions.get(sessionKey);
    if (!session) return interaction.update(expiredMessage);

    const expectedAttrs = session.type === 'keeper' ? ['Reflex', 'Positioning', 'Handling', 'Diving', 'Passing'] : ['Shooting', 'Dribbling', 'Defense', 'Passing', 'Vision'];
    const missing = expectedAttrs.filter(a => !session.attributes[a] || typeof session.attributes[a].rating !== 'number');
    if (missing.length > 0) return interaction.reply({ content: `Please set ratings for: ${missing.join(', ')}`, flags: 64 });

    const sum = expectedAttrs.reduce((acc, a) => acc + session.attributes[a].rating, 0);
    const totalPercent = Math.round((sum / (expectedAttrs.length * 10)) * 100);

    const data = readData();
    const entry = {
      raterId: session.raterId,
      raterTag: session.raterTag,
      raterAvatarURL: session.raterAvatarURL,
      targetId: session.targetId,
      targetName: session.targetTag,
      targetAvatarURL: session.targetAvatarURL,
      type: session.type,
      positionSpecific: session.positionSpecific || [],
      attributes: session.attributes,
      totalPercent,
      timestamp: Date.now()
    };
    data.push(entry);
    writeData(data);

    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    const embed = createRatingEmbed(entry, client);
    if (channel) {
      await channel.send({ embeds: [embed] }).catch(console.error);
    }

    sessions.delete(sessionKey);
    return interaction.update({ content: 'Rating submitted and announced!', components: [], embeds: [] });
  }
}


async function handleModal(interaction) {
  if (interaction.customId.startsWith('modal_comment:')) {
    const parts = interaction.customId.split(':');
    const attr = parts.pop();
    parts.shift();
    const sessionKey = parts.join(':');
    const session = sessions.get(sessionKey);
    
    if (!session) {
      return interaction.reply({ content: 'Session expired. Please start a new rating with /rate.', flags: 64 });
    }

    const comment = interaction.fields.getTextInputValue('comment_input');
    if (!session.attributes[attr]) session.attributes[attr] = {};
    session.attributes[attr].comment = comment || '';
    
    console.log(`[modal_comment] ${attr} comment: ${comment ? 'added' : 'cleared'}`);
    
    const currentIndex = session.currentAttrIndex || 0;
    const currentAttr = session.attrOrder[currentIndex];

    const rows = [
     makeRatingSelect('rating', sessionKey, currentAttr, session.attributes[currentAttr]?.rating
      ? `${session.attributes[currentAttr].rating}/10`
       : 'Select 1-10'),
     new ActionRowBuilder().addComponents(
       new ButtonBuilder()
         .setCustomId(`comment:${sessionKey}:${currentAttr}`)
         .setLabel(session.attributes[currentAttr]?.comment ? '✓ Comment Added' : 'Add Comment')
        .setStyle(session.attributes[currentAttr]?.comment ? ButtonStyle.Success : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`nav:${sessionKey}:back`)
         .setLabel('◀ Back')
         .setStyle(ButtonStyle.Secondary)
         .setDisabled(currentIndex === 0),
        new ButtonBuilder()
        .setCustomId(`nav:${sessionKey}:next`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    )
    ];
    
    await interaction.deferUpdate();
    
    try {
      const channel = await client.channels.fetch(session.channelId);
      const message = await channel.messages.fetch(session.messageId);
      await message.edit({ 
        content: `Rating ${session.targetTag} (${session.type === 'keeper' ? 'Goalkeeper' : 'Field Player'}) — Rate **${currentAttr}** (1-10):${comment ? '\n✓ Comment added!' : ''}`, 
        components: rows 
      });
    } catch (err) {
      console.error('Failed to update message after modal:', err);
      try {
        await interaction.editReply({ 
          content: `Rating ${session.targetTag} (${session.type === 'keeper' ? 'Goalkeeper' : 'Field Player'}) — Rate **${currentAttr}** (1-10):${comment ? '\n✓ Comment added!' : ''}`, 
          components: rows 
        });
      } catch (e) {
        console.error('Fallback update also failed:', e);
      }
    }
  }
}

client.login(TOKEN);
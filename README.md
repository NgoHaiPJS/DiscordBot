# Discord Rating Bot

This is a minimal Discord bot that allows privileged users to rate players (field players or goalkeepers), stores ratings, and shows a simple leaderboard.

Features
- /rate @player - interactive UI to rate a player (role-restricted via RATER_ROLE_ID)
- /myratings [player] - view ratings for yourself or another player
- /leaderboard - show top players by average rating

Quick setup
1. Create a bot application on the Discord Developer Portal and copy the Bot Token, Client ID.
2. Invite the bot to your server (with applications.commands and bot scopes). For development you can register commands to a single guild.
3. Create a `.env` file in the project root with:

```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_dev_guild_id
RATER_ROLE_ID=role_id_allowed_to_rate  # optional
```

4. Install dependencies:

```powershell
npm install
```

5. Register commands to your guild:

```powershell
npm run register
```

6. Start the bot:

```powershell
npm start
```

Notes and limitations
- This is a straightforward example using a JSON file at `data/ratings.json` for persistence. For production use a proper database.
- The interactive UI uses ephemeral messages for the rater and posts the final announcement into the channel where `/rate` was invoked.
- Comments are added per-attribute via buttons; ratings are selected via select menus.
- The code includes a simple role check using `RATER_ROLE_ID` environment variable.

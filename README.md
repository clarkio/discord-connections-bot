# discord-connections-bot

A bot for Discord to track shared player results of the game Connections by the NYT.
Domain language lives in [CONTEXT.md](CONTEXT.md).

Stack matches [discord-wordle-bot](https://github.com/clarkio/discord-wordle-bot): Bun, TypeScript,
discord.js 14, and (for the live bot, not yet built) Turso with Drizzle on Railway.

## Status

Phase 1 of 2: choose the scoring model from real history. The live bot comes after.

- `src/connections/parser.ts`: turns a shared result into guesses, mistakes, rainbow guesses and solve order.
  Returns `null` for non-shares and `invalid` for impossible shares (the bot will react with ❌).
- `src/scoring/`: two candidate models, **B** (ranked tuple) and **D** (weighted points).
  Every weight is in `src/scoring/config.ts`.
- `src/analysis/` and `scripts/`: export a channel's history, then compare the models.

## Choosing a scoring model

```bash
BOT_TOKEN=... TARGET_CHANNEL_ID=... bun run history:fetch   # writes data/history.json (gitignored)
bun run history:analyze                                    # compares B and D, with parameter sweeps
```

The fetch script needs the Message Content intent and Read Message History on the channel. It writes only
salted player hashes, puzzle numbers and guess rows. Set `HASH_SALT` to keep hashes stable between runs.

The analysis reports, per model and per sweep setting, over puzzles with two or more players: single-winner
rate (primary), average winner-group size, average margin between first and second (model D only), and the
share of puzzles where everyone tied.

## Development

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
```

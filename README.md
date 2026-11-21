# discord-connections-bot

A bot for Discord to track shared player results of the game Connections by the NYT.
Domain language lives in [CONTEXT.md](CONTEXT.md).

Stack matches [discord-wordle-bot](https://github.com/clarkio/discord-wordle-bot): Bun, TypeScript,
discord.js 14, and Turso with Drizzle, deployed on Railway.

## Status

Phase 1 (done): chose the scoring model from real channel history. Phase 2 (this): the live bot.

## The live bot

Reads shares posted in `TARGET_CHANNEL_ID`, scores each one, stores it in Turso, and announces who is
currently winning that puzzle whenever the sharer is among the winners (a tie is announced too).

- 🌈 as well as ✅ on a counted share that contains a rainbow guess (one word from each of the four categories).
- ✅ on a counted share, ❌ on a message that looks like a share but is impossible, nothing for a duplicate
  (the first share per player and puzzle counts; a first-ever share for an old puzzle is accepted).
- Scoring is fixed to model **R**, with the settings in `src/scoring/production.ts`.
- Commands: `!optin`, `!optout` (players are opted out by default; opt-in only controls public leaderboard
  data, results are recorded either way), `!results [puzzle]` (your result plus lifetime totals).
- `IGNORED_USER_IDS` players are recorded but never count toward winners or ties. `USER_TAGGING_ENABLED=true`
  (any letter case) mentions winners instead of printing names; if it is unset or anything else, names are printed.

```bash
cp .env.example .env   # fill in BOT_TOKEN and TARGET_CHANNEL_ID
bun install --frozen-lockfile
bun run start          # migrations run on boot
```

On Railway set the variables in `.env.example` and use `bun run start` as the start command. Run a single
instance only, or each share would be processed twice. The bot needs the Message Content intent and permission
to read messages, add reactions and send messages in the channel.

Storage keeps the raw share (`results`) separate from its derived score and outcome (`scores`).
Change the schema in `src/db/schema.ts` and run `bun run db:generate` to produce a migration.

- `src/connections/parser.ts`: turns a shared result into guesses, mistakes, rainbow guesses and solve order.
  Returns `null` for non-shares and `invalid` for impossible shares (the bot will react with ❌).
- `src/scoring/`: three candidate models: **B** (ranked tuple), **D** (weighted points with a bonus per harder-before-easier pair) and **P** (weighted points with a bonus for solving a category ahead of its natural position: purple 1st earns most) and **Q** (P with each place worth more units for harder categories, in whole multiples of 0.25, so it separates more solve orders) and **R** (Q plus a whole-number bonus for a game with no mistakes, sized so a clean game always beats any game with a mistake).
  Every weight is in `src/scoring/config.ts`.
- `src/analysis/` and `scripts/`: export a channel's history, then compare the models.

## Loading past results into the database

```bash
BOT_TOKEN=... TARGET_CHANNEL_ID=... TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run history:backfill          # dry run
BOT_TOKEN=... TARGET_CHANNEL_ID=... TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run history:backfill --apply  # write
```

It reads the channel history and loads each share with the player's real Discord id and name (the analysis
export above hashes them, so it can't be used for this). It scores shares exactly like the live bot, sets each
puzzle's win and tie flags, and announces nothing. The first share per player and puzzle counts, results already in
the database are never overwritten, and it is safe to run again or while the bot is running. Set `IGNORED_USER_IDS`
the same as on the bot.

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
It also prints example puzzles for each outcome (with a line-by-line score breakdown for the scored models) (clear winner, tie, everyone tied). Use
`--model=B,D,P,Q,R|all` (default D,P,Q,R), `--order-bonus=`, `--position-bonus=`, `--position-unit=`, `--rainbow-penalty=` and `--examples=N` and `--first=Y|G|B|P` (only puzzles where someone solved that category first) to choose what the examples use.

## Development

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
```

# Connections Bot

A Discord bot that reads the NYT Connections results players share in a channel, scores each one, and announces who is currently winning that puzzle.

## Language

**Puzzle**:
One daily NYT Connections game, identified by its puzzle number.
_Avoid_: Game, round, day

**Share**:
The pasted result text a player posts for a puzzle: the puzzle number plus one row of four coloured squares per guess.
_Avoid_: Result, submission, post

**Guess**:
One row of a share. Each square is coloured by the category its word actually belongs to.
_Avoid_: Attempt, row, turn

**Category**:
One of the four hidden groups of a puzzle, coloured yellow, green, blue or purple in increasing difficulty.
_Avoid_: Group, color

**Solved category**:
A category a player completed with a guess of four squares of one colour.
_Avoid_: Correct guess, match

**Mistake**:
A guess that is not a solved category. Four mistakes end the puzzle as a failure.
_Avoid_: Miss, strike, wrong guess

**Rainbow guess**:
A mistake whose four squares are four different colours, one word from each category. It is rare, and is treated more kindly than an ordinary mistake.
_Avoid_: Spread, wildcard

**Solve order**:
The sequence in which a player solved the categories. Solving a harder category before an easier one is the mark of a strong player.
_Avoid_: Path, ordering

**Failed puzzle**:
A puzzle the player ended with four mistakes before solving every category. It still takes part in ranking.
_Avoid_: Loss, X

## Scoring

**Scoring model**:
A named rule for turning a share into a daily score and for ranking players on a puzzle. Candidate models were compared against real history once; the bot runs with the single model chosen from that comparison, and it never switches.
_Avoid_: Algorithm, formula, ruleset

**Daily score**:
The number a scoring model gives one player's share for one puzzle.
_Avoid_: Points, rating

**Position bonus**:
Extra daily score for each category solved earlier than its natural place (yellow first, green second, blue third, purple fourth), worth more the harder the category. Solving purple first earns the most.
_Avoid_: Order bonus, speed bonus, streak

**Clean game bonus**:
Extra daily score for a puzzle solved with no mistakes at all, large enough that a clean game always outscores any game with a mistake.
_Avoid_: Perfect bonus, flawless bonus

**Winner**:
The player (or players) ranked first on a puzzle at the moment a share is processed. It can change as more shares arrive.
_Avoid_: Champion, top scorer

**Tie**:
Two or more players ranked equally first on a puzzle, meaning their results score identically under the scoring model. Failed puzzles are not special: if everyone ends on the same score, that is a tie like any other.
_Avoid_: Draw

## Players

**Player**:
A Discord user who has shared at least one result.
_Avoid_: User, member

**Opted in**:
A player who has chosen to appear in public leaderboard data. Their results are recorded either way.
_Avoid_: Subscribed, enrolled

**Ignored player**:
A player whose shares are recorded but never count towards winners or ties.
_Avoid_: Banned, blocked

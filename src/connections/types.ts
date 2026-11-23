/** The four categories of a puzzle, easiest to hardest: yellow, green, blue, purple. */
export type Color = 'Y' | 'G' | 'B' | 'P';

/** Difficulty rank of each category; higher is harder. */
export const DIFFICULTY: Record<Color, number> = { Y: 1, G: 2, B: 3, P: 4 };

/** The coloured square each category appears as in a share. */
export const COLOR_SQUARE: Record<Color, string> = { Y: '🟨', G: '🟩', B: '🟦', P: '🟪' };

export interface Guess {
  colors: Color[];
  /** solved: one colour. rainbow: four different colours. mistake: anything else. */
  kind: 'solved' | 'mistake' | 'rainbow';
  /** Set when kind is 'solved'. */
  category?: Color;
}

export interface Share {
  puzzleNumber: number;
  guesses: Guess[];
  solvedOrder: Color[];
  /** Ordinary mistakes only; a rainbow guess is counted in `rainbows` instead. */
  mistakes: number;
  rainbows: number;
  /** True when the player used all four mistakes (ordinary + rainbow) before solving every category. */
  failed: boolean;
}

export type ParseResult =
  | { status: 'ok'; share: Share }
  | { status: 'invalid'; reason: string };

import { describe, expect, test } from 'bun:test';
import { parseShare } from '../connections/parser';

const share = (rows: string[], header = 'Connections\nPuzzle #1,234') => `${header}\n${rows.join('\n')}`;

const PERFECT = ['🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'];

describe('parseShare: recognising a share', () => {
  test('ignores messages that are not Connections shares', () => {
    expect(parseShare('good morning everyone')).toBeNull();
    expect(parseShare('Wordle 1,234 3/6\n⬛🟨⬛⬛⬛')).toBeNull();
  });

  test('a message mentioning Connections without a puzzle number is not a share', () => {
    expect(parseShare('I love Connections')).toBeNull();
  });

  test('a header with no guess rows looks like a share but is invalid', () => {
    expect(parseShare('Connections\nPuzzle #12')).toMatchObject({ status: 'invalid' });
  });
});

describe('parseShare: valid results', () => {
  test('perfect game, easiest first', () => {
    const r = parseShare(share(PERFECT));
    expect(r).toMatchObject({ status: 'ok' });
    if (r?.status !== 'ok') throw new Error('unreachable');
    expect(r.share.puzzleNumber).toBe(1234);
    expect(r.share.solvedOrder).toEqual(['Y', 'G', 'B', 'P']);
    expect(r.share.mistakes).toBe(0);
    expect(r.share.rainbows).toBe(0);
    expect(r.share.failed).toBe(false);
  });

  test('puzzle numbers parse with or without a thousands separator', () => {
    for (const header of ['Connections\nPuzzle #1,234', 'Connections\nPuzzle #1234']) {
      const r = parseShare(share(PERFECT, header));
      expect(r?.status === 'ok' && r.share.puzzleNumber).toBe(1234);
    }
  });

  test('chatter before and after the share is tolerated', () => {
    const r = parseShare(`so close today!\n${share(PERFECT)}\nsee you tomorrow`);
    expect(r?.status).toBe('ok');
  });

  test('keeps solve order when the hardest categories go first', () => {
    const r = parseShare(share(['🟪🟪🟪🟪', '🟦🟦🟦🟦', '🟩🟩🟩🟩', '🟨🟨🟨🟨']));
    expect(r?.status === 'ok' && r.share.solvedOrder).toEqual(['P', 'B', 'G', 'Y']);
  });

  test('counts an ordinary mistake', () => {
    const r = parseShare(share(['🟨🟨🟨🟩', ...PERFECT]));
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.share.mistakes).toBe(1);
    expect(r.share.rainbows).toBe(0);
    expect(r.share.guesses[0]!.kind).toBe('mistake');
  });

  test('a row of four different colours is a rainbow guess, and still uses a mistake', () => {
    const r = parseShare(share(['🟨🟩🟦🟪', ...PERFECT]));
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.share.rainbows).toBe(1);
    expect(r.share.mistakes).toBe(0);
    expect(r.share.guesses[0]!.kind).toBe('rainbow');
  });

  test('rainbow guesses can repeat', () => {
    const r = parseShare(share(['🟨🟩🟦🟪', '🟪🟦🟩🟨', ...PERFECT]));
    expect(r?.status === 'ok' && r.share.rainbows).toBe(2);
  });

  test('a failed game: four mistakes, some categories solved', () => {
    const r = parseShare(share(['🟨🟨🟨🟨', '🟩🟩🟩🟦', '🟩🟩🟦🟦', '🟪🟪🟩🟩', '🟪🟦🟪🟪']));
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.share.failed).toBe(true);
    expect(r.share.solvedOrder).toEqual(['Y']);
    expect(r.share.mistakes).toBe(4);
  });

  test('a failed game with nothing solved', () => {
    const r = parseShare(share(['🟨🟨🟩🟩', '🟨🟨🟦🟦', '🟪🟪🟩🟩', '🟦🟪🟦🟪']));
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.share.failed).toBe(true);
    expect(r.share.solvedOrder).toEqual([]);
  });
});

describe('parseShare: shares that look real but cannot be', () => {
  test.each([
    ['only three categories and no failure', ['🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦']],
    ['the same category solved twice', ['🟨🟨🟨🟨', '🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪']],
    ['five mistakes', ['🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩']],
    ['a solved row after the fourth mistake', ['🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟨']],
    ['four mistakes yet all categories solved', ['🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', ...PERFECT]],
    ['a row with the wrong number of squares', ['🟨🟨🟨', ...PERFECT]],
  ])('%s', (_label, rows) => {
    expect(parseShare(share(rows))).toMatchObject({ status: 'invalid' });
  });
});

describe('parseShare: spoilered shares', () => {
  const plain = share(PERFECT);
  const expectSameAsPlain = (text: string) => {
    const parsed = parseShare(text);
    expect(parsed).toEqual(parseShare(plain));
    expect(parsed?.status).toBe('ok');
  };

  test('the whole share inside one spoiler', () => {
    expectSameAsPlain(`||${plain}||`);
  });

  test('chatter outside the spoiler is fine', () => {
    expectSameAsPlain(`I lost today\n||${plain}||`);
    expectSameAsPlain(`||${plain}||\nHaha so used to marking as spoiler for wordle`);
  });

  test('every line wrapped in its own spoiler', () => {
    expectSameAsPlain(plain.split('\n').map((line) => `||${line}||`).join('\n'));
  });

  test('the header and the rows spoilered separately', () => {
    expectSameAsPlain(`||Connections||\n||Puzzle #1,234||\n||${PERFECT.join('\n')}||`);
  });

  test('spaces just inside the markers', () => {
    expectSameAsPlain(`|| ${plain} ||`);
  });

  test('a failed game hidden in a spoiler keeps its mistakes and solved groups', () => {
    const failed = share(['🟨🟨🟨🟨', '🟩🟩🟦🟦', '🟩🟩🟪🟪', '🟦🟦🟩🟩', '🟪🟦🟪🟦']);
    const parsed = parseShare(`||${failed}||`);
    expect(parsed).toEqual(parseShare(failed));
    expect(parsed?.status === 'ok' && parsed.share.failed).toBe(true);
  });

  test('an impossible share is still invalid when spoilered', () => {
    expect(parseShare('||Connections\nPuzzle #12\n🟨🟨🟨🟨||')).toMatchObject({ status: 'invalid' });
  });

  test('a spoiler that is not a share is still ignored', () => {
    expect(parseShare('||the butler did it||')).toBeNull();
    expect(parseShare('||||')).toBeNull();
  });
});

describe('parseShare: the reason a share is impossible', () => {
  const reason = (rows: string[], header = 'Connections\nPuzzle #12') => {
    const r = parseShare(`${header}\n${rows.join('\n')}`);
    return r?.status === 'invalid' ? r.reason : undefined;
  };

  test('a header with no rows', () => {
    expect(reason([])).toBe('the header is there but no rows of coloured squares follow it');
  });
  test('a row that is not four squares', () => {
    expect(reason(['🟨🟨🟨', ...PERFECT])).toBe('a row does not have exactly four squares');
  });
  test('guesses after the fourth mistake', () => {
    expect(reason(['🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟨'])).toBe('there are guesses after the fourth mistake, but the game ends at four');
  });
  test('the same group solved twice', () => {
    expect(reason(['🟨🟨🟨🟨', '🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'])).toBe('the same colour group was solved twice');
  });
  test('all four groups solved despite four mistakes', () => {
    expect(reason(['🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', ...PERFECT])).toBe('there are guesses after the fourth mistake, but the game ends at four');
    expect(reason([...PERFECT.slice(0, 3), '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩', '🟨🟨🟨🟩'])).toBe('all four groups are solved but four mistakes were also made, which the game does not allow');
  });
  test('an unfinished puzzle', () => {
    expect(reason(['🟨🟨🟨🟨', '🟩🟩🟩🟩'])).toBe('the puzzle looks unfinished: fewer than four groups solved and fewer than four mistakes made');
  });
});

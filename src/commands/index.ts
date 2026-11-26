import { createHelpCommand } from './help';
import { optInCommand, optOutCommand } from './opt';
import { resultsCommand } from './results';
import { scoringCommand } from './scoring';
import { standingsCommand } from './standings';
import type { Command } from './types';

const helpCommand = createHelpCommand(() => COMMANDS.values());

/** In the order !help lists them. */
const ALL_COMMANDS: Command[] = [resultsCommand, standingsCommand, scoringCommand, optInCommand, optOutCommand, helpCommand];

/** Every name and alias a player can type, mapped to its command. */
export const COMMANDS = new Map<string, Command>(
  ALL_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((name) => [name, c] as const)),
);

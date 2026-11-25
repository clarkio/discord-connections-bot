import { optInCommand, optOutCommand } from './opt';
import { resultsCommand } from './results';
import { scoringCommand } from './scoring';
import type { Command } from './types';

export const COMMANDS = new Map<string, Command>(
  [optInCommand, optOutCommand, resultsCommand, scoringCommand].map((c) => [c.name, c]),
);

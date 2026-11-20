import { optInCommand, optOutCommand } from './opt';
import { resultsCommand } from './results';
import type { Command } from './types';

export const COMMANDS = new Map<string, Command>(
  [optInCommand, optOutCommand, resultsCommand].map((c) => [c.name, c]),
);

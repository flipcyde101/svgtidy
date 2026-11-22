#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const code = await runCli(process.argv.slice(2));
if (typeof code === 'number' && code !== 0) {
  process.exitCode = code;
}

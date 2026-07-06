#!/usr/bin/env node
import { main } from './comet-runtime.mjs';
process.exitCode = await main(["hook-guard", ...process.argv.slice(2)]);

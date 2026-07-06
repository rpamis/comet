#!/usr/bin/env node
import { main } from './comet-runtime.mjs';
process.exitCode = await main(["intent", ...process.argv.slice(2)]);

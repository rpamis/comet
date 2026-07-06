#!/usr/bin/env node
import { main } from './comet-runtime.mjs';
process.exitCode = await main(["archive", ...process.argv.slice(2)]);

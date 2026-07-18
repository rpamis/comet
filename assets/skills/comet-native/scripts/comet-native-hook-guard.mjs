#!/usr/bin/env node
import { main } from './comet-native-runtime.mjs';

process.exitCode = await main(['hook-guard', ...process.argv.slice(2)]);

#!/usr/bin/env node
// The `loam` executable: hand argv to the CLI and let it set the exit code.

import { main } from "./cli.js";

void main(process.argv.slice(2));

#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api';

await tsImport('../git-hours.ts', import.meta.url);

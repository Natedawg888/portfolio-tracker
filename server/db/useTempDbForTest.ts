/**
 * Import this first in a test that uses the database: it points DATABASE_PATH at a fresh temp
 * folder, so the test never writes to the developer's real data/portfolio.db. It has to be the
 * first import because db/index.ts reads DATABASE_PATH when it loads.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-db-')), 'portfolio.db');

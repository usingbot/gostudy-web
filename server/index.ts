import {Pool} from 'pg';

import {createApp} from './app.js';
import {loadConfig} from './config.js';

const config = loadConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  ssl: config.databaseSsl,
});
pool.on('error', () => console.error('PostgreSQL pool error'));
const app = createApp(config, pool);

const server = app.listen(config.port, () => {
  console.log(`Go Study server listening on port ${config.port}`);
});

async function shutDown(): Promise<void> {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutDown());
process.on('SIGTERM', () => void shutDown());

import 'dotenv/config';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';

const config = loadConfig(process.env);
const app = await buildApp({ config, nexon: new HttpNexonClient({}) });
await app.listen({ port: config.port, host: '0.0.0.0' });

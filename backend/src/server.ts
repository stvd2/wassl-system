import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
app.listen(env.port, '0.0.0.0', () => console.log(`[WASL v1] listening on ${env.port}`));

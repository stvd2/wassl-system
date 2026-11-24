// Legacy Express backend. Data routes are intentionally disabled: the service_role
// key must never be used by unauthenticated state/import/delete endpoints.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/tools', express.static(path.join(__dirname, '..', 'public', 'tools')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'wassl-backend', time: new Date().toISOString() }));

// Fail closed. Use the authenticated serverless API routes instead.
for (const [method, route] of [['get', '/api/state'], ['put', '/api/state'], ['delete', '/api/state'], ['post', '/api/import']]) {
  app[method](route, (_req, res) => res.status(410).json({
    error: 'هذا المسار القديم معطّل. استخدم واجهة API الموثقة.'
  }));
}

app.listen(PORT, () => console.log(`[WASL] legacy static server listening on port ${PORT}`));

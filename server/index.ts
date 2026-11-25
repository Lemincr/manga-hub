import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './routes.js';
import { ROOT } from './db.js';
import { schedulePolling } from './service.js';
import { cachePrune } from './http.js';

const app = express();
app.disable('x-powered-by');
app.use('/api', api);

// Prevent unhandled rejections or uncaught exceptions from silently terminating the background server
process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});

const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('API running. Run `npm run dev` (UI on :5173) or `npm run build` first.'));
}

const preferred = Number(process.env.PORT ?? 3001);
// Bind to loopback only: this is a personal local app, not meant to be exposed to the network.
// If the preferred port is taken (e.g. a second copy), fall back to a random free one.
export const port: number = await new Promise((resolve, reject) => {
  const start = (p: number) => {
    const server = app.listen(p, '127.0.0.1', () => resolve((server.address() as any).port));
    server.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' && p !== 0 ? start(0) : reject(e)));
  };
  start(preferred);
});
console.log(`Manga Hub → http://localhost:${port}`);
cachePrune();
schedulePolling();

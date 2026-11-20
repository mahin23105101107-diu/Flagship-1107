import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { buildApiRouter } from './server/routes';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  // Structured JSON request logging (C4 Observability)
  app.use((req, res, next) => {
    const traceId = (req.headers['x-trace-id'] as string) || `tr-${Date.now().toString(36)}`;
    res.setHeader('X-Trace-Id', traceId);
    next();
  });

  // Mount FlagShip REST + SSE API
  app.use('/api/v1', buildApiRouter());

  // Actuator-style aliases (C4)
  app.get('/actuator/health', (_req, res) => res.redirect(307, '/api/v1/health'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        level: 'INFO',
        service: 'flagship-server',
        message: `FlagShip server listening on http://0.0.0.0:${PORT}`,
        mode: isProduction ? 'production' : 'development',
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start FlagShip server:', err);
  process.exit(1);
});

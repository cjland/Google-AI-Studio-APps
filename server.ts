import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

// Import Vercel API handlers
import bootstrapHandler from './api/bootstrap';
import gigsHandler from './api/gigs';
import healthHandler from './api/health';
import saveStateHandler from './api/save-state';
import setupHandler from './api/setup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON body
  app.use(express.json({ limit: '10mb' }));

  // Adapter helper to map Vercel serverless handlers to Express
  const adaptHandler = (handler: any) => {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        await handler(req, res);
      } catch (err) {
        next(err);
      }
    };
  };

  // Register API routes BEFORE Vite middleware
  app.get('/api/bootstrap', adaptHandler(bootstrapHandler));
  app.route('/api/setup')
    .get(adaptHandler(setupHandler))
    .post(adaptHandler(setupHandler));
  
  app.route('/api/gigs')
    .get(adaptHandler(gigsHandler))
    .post(adaptHandler(gigsHandler))
    .patch(adaptHandler(gigsHandler))
    .delete(adaptHandler(gigsHandler));

  app.get('/api/health', adaptHandler(healthHandler));
  app.put('/api/save-state', adaptHandler(saveStateHandler));

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // General error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      detail: err.message || 'An unexpected error occurred'
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

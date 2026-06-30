import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );

  return res.status(200).json({
    ok: true,
    test: 'minimal-bootstrap',
    message: 'The bootstrap function loaded successfully.',
    method: req.method,
    nodeVersion: process.version,
    vercelEnvironment:
      process.env.VERCEL_ENV ?? null,
    databaseUrlPresent:
      Boolean(process.env.DATABASE_URL),
    timestamp: new Date().toISOString()
  });
}
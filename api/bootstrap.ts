import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

function serializeError(error: unknown) {
  const err = error as any;

  return {
    name:
      typeof err?.name === 'string'
        ? err.name
        : null,

    message:
      typeof err?.message === 'string'
        ? err.message
        : String(error ?? 'Unknown error'),

    code:
      typeof err?.code === 'string'
        ? err.code
        : null,

    stack:
      typeof err?.stack === 'string'
        ? err.stack
        : null,

    cause: (() => {
      try {
        return err?.cause
          ? JSON.stringify(err.cause)
          : null;
      } catch {
        return String(err?.cause ?? '');
      }
    })()
  };
}

async function testImport(
  moduleName: string,
  importFunction: () => Promise<any>
) {
  try {
    const importedModule = await importFunction();

    return {
      module: moduleName,
      ok: true,
      exports: Object.keys(importedModule)
    };
  } catch (error) {
    return {
      module: moduleName,
      ok: false,
      error: serializeError(error)
    };
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );

  const results = [];

  results.push(
    await testImport(
      'node:crypto',
      () => import('node:crypto')
    )
  );

  results.push(
    await testImport(
      '@neondatabase/serverless',
      () => import('@neondatabase/serverless')
    )
  );

  results.push(
    await testImport(
      './_lib/db.js',
      () => import('./_lib/db.js')
    )
  );

  results.push(
    await testImport(
      './_lib/currentBand.js',
      () => import('./_lib/currentBand.js')
    )
  );

  results.push(
    await testImport(
      './_lib/mappers.js',
      () => import('./_lib/mappers.js')
    )
  );

  const dbResult = results.find(
    result => result.module === './_lib/db.js'
  );

  let databaseClientTest: any = null;

  if (dbResult?.ok) {
    try {
      const dbModule = await import('./_lib/db.js');

      databaseClientTest = {
        ok: true,
        hasGetSql:
          typeof dbModule.getSql === 'function',
        hasHasDatabaseUrl:
          typeof dbModule.hasDatabaseUrl === 'function',
        hasEnsureSchema:
          typeof dbModule.ensureSchema === 'function',
        exports: Object.keys(dbModule)
      };
    } catch (error) {
      databaseClientTest = {
        ok: false,
        error: serializeError(error)
      };
    }
  }

  const mapperResult = results.find(
    result => result.module === './_lib/mappers.js'
  );

  let mapperExportTest: any = null;

  if (mapperResult?.ok) {
    try {
      const mapperModule =
        await import('./_lib/mappers.js');

      mapperExportTest = {
        ok: true,
        mapSong:
          typeof mapperModule.mapSong === 'function',
        mapGig:
          typeof mapperModule.mapGig === 'function',
        mapGigSet:
          typeof mapperModule.mapGigSet === 'function',
        mapSetSongPlacement:
          typeof mapperModule.mapSetSongPlacement ===
          'function',
        exports: Object.keys(mapperModule)
      };
    } catch (error) {
      mapperExportTest = {
        ok: false,
        error: serializeError(error)
      };
    }
  }

  const currentBandResult = results.find(
    result =>
      result.module === './_lib/currentBand.js'
  );

  let currentBandExportTest: any = null;

  if (currentBandResult?.ok) {
    try {
      const currentBandModule =
        await import('./_lib/currentBand.js');

      currentBandExportTest = {
        ok: true,
        hasGetCurrentBand:
          typeof currentBandModule.getCurrentBand ===
          'function',
        exports: Object.keys(currentBandModule)
      };
    } catch (error) {
      currentBandExportTest = {
        ok: false,
        error: serializeError(error)
      };
    }
  }

  return res.status(200).json({
    ok:
      results.every(result => result.ok) &&
      databaseClientTest?.ok !== false &&
      mapperExportTest?.ok !== false &&
      currentBandExportTest?.ok !== false,

    test: 'bootstrap-import-diagnostics-v3',

    environment: {
      nodeVersion: process.version,
      vercelEnvironment:
        process.env.VERCEL_ENV ?? null,
      databaseUrlPresent:
        Boolean(process.env.DATABASE_URL)
    },

    results,
    databaseClientTest,
    mapperExportTest,
    currentBandExportTest
  });
}
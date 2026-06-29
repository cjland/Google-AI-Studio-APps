import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let cachedSql: NeonQueryFunction<false, false> | null = null;
let schemaEnsured = false;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getSql(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    const error = new Error(
      'DATABASE_URL is not available to this serverless function.'
    ) as Error & { code?: string };

    error.code = 'DATABASE_URL_MISSING';
    throw error;
  }

  if (!cachedSql) {
    cachedSql = neon(databaseUrl);
  }

  return cachedSql;
}

export async function ensureSchema(): Promise<void> {
  return;
}

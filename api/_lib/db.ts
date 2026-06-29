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
  if (schemaEnsured) return;
  const sql = getSql();

  try {
    // Sequentially create tables if they do not exist
    await sql`
      CREATE TABLE IF NOT EXISTS bands (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS songs (
        id UUID PRIMARY KEY,
        band_id INTEGER REFERENCES bands(id) ON DELETE CASCADE,
        external_id VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255),
        duration_seconds INTEGER DEFAULT 0,
        video_url TEXT,
        tags TEXT[],
        rating INTEGER,
        status VARCHAR(50),
        guitar_url TEXT,
        bass_url TEXT,
        lyrics_url TEXT,
        notes TEXT,
        google_sheet_row INTEGER,
        source_updated_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS gigs (
        id UUID PRIMARY KEY,
        band_id INTEGER REFERENCES bands(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        gig_date VARCHAR(50),
        start_time VARCHAR(50),
        arrival_time VARCHAR(50),
        notes TEXT,
        status VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS gig_sets (
        id UUID PRIMARY KEY,
        gig_id UUID REFERENCES gigs(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        set_number INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        status VARCHAR(50),
        target_duration_seconds INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS set_songs (
        id UUID PRIMARY KEY,
        set_id UUID REFERENCES gig_sets(id) ON DELETE CASCADE,
        song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    schemaEnsured = true;
    console.log('Database schema successfully verified/created.');
  } catch (error) {
    console.error('Failed to verify/create database schema:', error);
    throw error;
  }
}

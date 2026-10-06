import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export function query(text, values) {
  return pool.query(text, values);
}

export async function ensureRichTextColumns() {
  await pool.query(`
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS formatted_content TEXT NOT NULL DEFAULT '';
    ALTER TABLE versions ADD COLUMN IF NOT EXISTS content_html TEXT NOT NULL DEFAULT '';
  `);
}

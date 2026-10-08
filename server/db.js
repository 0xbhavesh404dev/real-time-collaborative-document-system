import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

export async function ensureAITables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id SERIAL PRIMARY KEY,
      document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      kind VARCHAR(40) NOT NULL,
      input_text TEXT,
      output_text TEXT,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_document ON ai_suggestions(document_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS plagiarism_reports (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      score NUMERIC(5,2) NOT NULL,
      matches JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_plagiarism_reports_document ON plagiarism_reports(document_id, created_at DESC);
  `);
}

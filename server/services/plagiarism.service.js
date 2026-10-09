import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.resolve(__dirname, '../db/seeds/corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function buildIdf(documents) {
  const df = new Map();
  for (const document of documents) {
    const seen = new Set(tokenize(document));
    for (const token of seen) df.set(token, (df.get(token) || 0) + 1);
  }
  const total = documents.length || 1;
  return new Map(Array.from(df, ([token, count]) => [token, Math.log((total + 1) / (count + 1)) + 1]));
}

const idf = buildIdf(corpus.map((item) => item.text));

function vectorize(text) {
  const tokens = tokenize(text);
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  const size = tokens.length || 1;
  const vector = new Map();
  for (const [token, count] of tf) {
    const weight = (count / size) * (idf.get(token) || 1);
    vector.set(token, weight);
  }
  return vector;
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [token, value] of a) dot += value * (b.get(token) || 0);
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

const corpusVectors = corpus.map((item) => ({ ...item, vector: vectorize(item.text) }));

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => tokenize(item).length > 8);
}

export function analyzePlagiarism(text) {
  const sentences = splitSentences(text);
  const matches = [];
  const similarityScores = [];

  for (const phrase of sentences) {
    const vector = vectorize(phrase);
    let best = null;
    for (const source of corpusVectors) {
      const similarity = cosine(vector, source.vector);
      if (!best || similarity > best.similarity) best = { source, similarity };
    }
    const score = best ? best.similarity : 0;
    similarityScores.push(score);
    if (best && score >= 0.70) {
      matches.push({
        source: best.source.source,
        url: best.source.url,
        match_pct: Math.round(score * 100),
        phrase
      });
    }
  }

  const average = similarityScores.length
    ? similarityScores.reduce((sum, score) => sum + score, 0) / similarityScores.length
    : 0;
  const score = Math.round(average * 100);

  return {
    score,
    risk: Math.min(100, Math.max(0, score)),
    matches: matches.slice(0, 10),
    scannedSentences: sentences.length,
    provider: process.env.PLAGIARISM_PROVIDER || 'local'
  };
}

export function compareWithReference(text, referenceText) {
  const source = String(text || '').trim();
  const reference = String(referenceText || '').trim();
  const sourceSentences = splitSentences(source);
  const referenceSentences = splitSentences(reference);
  const matches = [];
  const scores = [];

  for (const sentence of sourceSentences) {
    const vector = vectorize(sentence);
    let best = null;
    for (const referenceSentence of referenceSentences) {
      const similarity = cosine(vector, vectorize(referenceSentence));
      if (!best || similarity > best.similarity) best = { sentence: referenceSentence, similarity };
    }
    const score = best?.similarity || 0;
    scores.push(score);
    if (best && score >= 0.25) {
      const sourceTerms = new Set(tokenize(sentence));
      const overlap = [...new Set(tokenize(best.sentence))].filter((term) => sourceTerms.has(term));
      matches.push({
        source: 'Supplied reference text',
        url: '',
        match_pct: Math.round(score * 100),
        phrase: sentence,
        referencePhrase: best.sentence,
        overlappingPhrases: overlap
      });
    }
  }

  const score = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 100) : 0;
  return {
    score,
    risk: score,
    matches: matches.sort((a, b) => b.match_pct - a.match_pct).slice(0, 10),
    scannedSentences: sourceSentences.length,
    referenceSentences: referenceSentences.length,
    provider: 'local-supplied-reference'
  };
}

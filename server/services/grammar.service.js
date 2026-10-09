import { createHash } from 'node:crypto';
import { grammarFallback } from './ai.service.js';
import { checkWithLanguageTool } from './languagetool.service.js';

const CACHE_LIMIT = 100;
const FALLBACK_COOLDOWN_MS = 60_000;
const resultCache = new Map();
const inFlight = new Map();
const fallbackCooldowns = new Map();

function cacheKey(text, userId) {
  const language = process.env.LANGUAGETOOL_LANGUAGE || 'en-US';
  return createHash('sha256').update(`${userId || 'anonymous'}\0${language}\0${text}`).digest('hex');
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function cacheResult(key, value) {
  resultCache.delete(key);
  resultCache.set(key, copy(value));
  while (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value);
}

function removeDuplicatesAndOverlaps(suggestions, text) {
  const sorted = suggestions
    .filter((item) => Number.isInteger(item.sourceOffset)
      && item.sourceOffset >= 0
      && text.slice(item.sourceOffset, item.sourceOffset + item.original.length) === item.original)
    .sort((left, right) => left.sourceOffset - right.sourceOffset || right.original.length - left.original.length);
  const accepted = [];
  const seen = new Set();
  let lastEnd = -1;

  for (const item of sorted) {
    const key = `${item.sourceOffset}\0${item.original}\0${item.suggestion}`;
    if (seen.has(key) || item.sourceOffset < lastEnd) continue;
    seen.add(key);
    accepted.push(item);
    lastEnd = item.sourceOffset + item.original.length;
  }
  return accepted;
}

export async function checkGrammar(text, { userId } = {}) {
  const source = String(text || '').trim().slice(0, 5000);
  if (!source) return { suggestions: [], provider: 'LanguageTool', fallback: false };

  const accountKey = String(userId || 'anonymous');
  const key = cacheKey(source, accountKey);
  if (resultCache.has(key)) {
    const cached = resultCache.get(key);
    resultCache.delete(key);
    resultCache.set(key, cached);
    return copy(cached);
  }
  if (inFlight.has(key)) {
    const { skipCache, ...result } = await inFlight.get(key);
    return copy(result);
  }

  const operation = (async () => {
    try {
      const suggestions = await checkWithLanguageTool(source);
      fallbackCooldowns.delete(accountKey);
      return {
        suggestions: removeDuplicatesAndOverlaps(suggestions, source),
        provider: 'LanguageTool',
        fallback: false
      };
    } catch (languageToolError) {
      if ((fallbackCooldowns.get(accountKey) || 0) > Date.now()) {
        return {
          suggestions: [],
          provider: 'LanguageTool unavailable',
          fallback: false,
          message: 'LanguageTool is unavailable. Gemini fallback is paused briefly to conserve API quota.',
          skipCache: true
        };
      }
      fallbackCooldowns.set(accountKey, Date.now() + FALLBACK_COOLDOWN_MS);
      try {
        const suggestions = await grammarFallback(source);
        return {
          suggestions: removeDuplicatesAndOverlaps(suggestions, source),
          provider: 'Gemini',
          fallback: true,
          message: 'LanguageTool is unavailable; Gemini provided a fallback grammar check.'
        };
      } catch (geminiError) {
        const error = new Error('Grammar checking is unavailable. Start LanguageTool or configure the Gemini fallback.');
        error.cause = { languageTool: languageToolError.message, gemini: geminiError.message };
        throw error;
      }
    }
  })();

  inFlight.set(key, operation);
  try {
    const result = await operation;
    const { skipCache, ...publicResult } = result;
    if (!skipCache) cacheResult(key, publicResult);
    return copy(publicResult);
  } finally {
    inFlight.delete(key);
  }
}

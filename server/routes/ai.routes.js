import express from 'express';
import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import { autocomplete, paraphrase, summarize, translate } from '../services/ai.service.js';
import { checkLanguageToolHealth } from '../services/languagetool.service.js';
import { checkGrammar } from '../services/grammar.service.js';
import { analyzePlagiarism } from '../services/plagiarism.service.js';

const router = express.Router();
router.use(requireAuth);

router.get('/status', async (_req, res) => {
  const localGrammarAvailable = await checkLanguageToolHealth();
  return res.json({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your-gemini-api-key'),
    localGrammarAvailable,
    grammarProvider: 'LanguageTool'
  });
});

const rateBuckets = new Map();
const WINDOW_MS = 60_000;
// This budget applies to Gemini-backed writing actions. Local LanguageTool
// checks do not consume the Gemini request budget.
const MAX_REQUESTS = Math.max(1, Number.parseInt(process.env.AI_REQUESTS_PER_MINUTE || '60', 10) || 60);

function rateLimit(req, res, next) {
  const userKey = String(req.user.id);
  const now = Date.now();
  const recent = (rateBuckets.get(userKey) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ message: `This app reached its ${MAX_REQUESTS}-request per minute safety limit. Try again in ${retryAfter} seconds.` });
  }
  recent.push(now);
  rateBuckets.set(userKey, recent);
  return next();
}

function requiredText(req, res, max = 12000) {
  const text = String(req.body?.text || '').trim();
  if (!text) {
    res.status(400).json({ message: 'Text is required' });
    return null;
  }
  if (text.length > max) {
    res.status(413).json({ message: `Text is too long. Maximum is ${max} characters.` });
    return null;
  }
  return text;
}

async function audit(documentId, userId, kind, inputText, outputText, accepted = false) {
  if (!documentId) return;
  try {
    await query(
      `INSERT INTO ai_suggestions (document_id, user_id, kind, input_text, output_text, accepted)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, userId, kind, inputText || '', outputText || '', accepted]
    );
  } catch (error) {
    console.warn('AI audit log unavailable:', error.message);
  }
}

router.post('/autocomplete', rateLimit, async (req, res) => {
  const text = requiredText(req, res, 500);
  if (!text) return;
  try {
    const suggestion = await autocomplete(text);
    await audit(req.body.documentId, req.user.id, 'autocomplete', text, suggestion);
    return res.json({ suggestion });
  } catch (error) {
    console.error('Autocomplete failed:', error);
    return res.json({ suggestion: '', fallback: true });
  }
});

router.post('/paraphrase', rateLimit, async (req, res) => {
  const text = requiredText(req, res, 2500);
  if (!text) return;
  try {
    const tone = ['academic', 'casual', 'concise'].includes(req.body?.tone) ? req.body.tone : 'academic';
    const audience = ['general', 'instructor', 'team', 'customers'].includes(req.body?.audience) ? req.body.audience : 'general';
    const goal = ['clarity', 'professional', 'persuasive', 'concise'].includes(req.body?.goal) ? req.body.goal : 'clarity';
    const alternatives = await paraphrase(text, tone, { audience, goal });
    await audit(req.body.documentId, req.user.id, 'paraphrase', text, alternatives.join(' ||| '));
    return res.json({ alternatives, tone });
  } catch (error) {
    console.error('Paraphrase failed:', error);
    const quotaExceeded = /\b429\b|quota/i.test(error.message || '');
    return res.json({
      alternatives: [],
      fallback: true,
      message: quotaExceeded
        ? 'Google AI quota is currently exhausted. Check Google AI Studio usage or try again after the quota resets.'
        : /did not preserve the full passage/i.test(error.message || '')
          ? 'The rewrite did not keep the full passage intact. Try again or select a shorter section.'
        : 'The AI writing service is temporarily unavailable. Please try again shortly.'
    });
  }
});

router.get('/grammar/health', async (_req, res) => {
  const available = await checkLanguageToolHealth();
  return res.json({ provider: 'LanguageTool', available });
});

router.post('/grammar', async (req, res) => {
  const text = requiredText(req, res, 5000);
  if (!text) return;
  try {
    const result = await checkGrammar(text, { userId: req.user.id });
    if (req.body?.manual) await audit(req.body.documentId, req.user.id, 'grammar', text, JSON.stringify(result.suggestions));
    if (result.fallback) console.info('Grammar provider: Gemini fallback; LanguageTool unavailable.');
    return res.json(result);
  } catch (error) {
    console.error('Grammar check failed:', error);
    return res.status(503).json({
      message: 'Grammar checking is temporarily unavailable. Check the LanguageTool service or Gemini configuration.'
    });
  }
});

router.post('/summarize', rateLimit, async (req, res) => {
  const text = requiredText(req, res, 24000);
  if (!text) return;
  try {
    const result = await summarize(text);
    await audit(req.body.documentId, req.user.id, 'summarize', text, result.summary);
    return res.json(result);
  } catch (error) {
    console.error('Summarize failed:', error);
    return res.json({ summary: 'The document is ready for AI summarization once an AI provider is configured.', fallback: true });
  }
});

router.post('/translate', rateLimit, async (req, res) => {
  const text = requiredText(req, res, 5000);
  if (!text) return;
  try {
    const language = String(req.body?.language || 'English').trim().slice(0, 60) || 'English';
    const translated = await translate(text, language);
    await audit(req.body.documentId, req.user.id, 'translate', text, translated);
    return res.json({ translated, language });
  } catch (error) {
    console.error('Translate failed:', error);
    return res.status(503).json({ message: 'Translation is unavailable. Configure the Gemini provider and try again.' });
  }
});

router.post('/plagiarism', async (req, res) => {
  const text = requiredText(req, res, 24000);
  if (!text) return;
  try {
    const report = analyzePlagiarism(text);
    if (req.body.documentId) {
      await query(
        `INSERT INTO plagiarism_reports (document_id, score, matches) VALUES ($1, $2, $3)`,
        [req.body.documentId, report.score, JSON.stringify(report.matches)]
      ).catch((error) => console.warn('Plagiarism report audit unavailable:', error.message));
    }
    return res.json(report);
  } catch (error) {
    console.error('Plagiarism check failed:', error);
    return res.status(500).json({ message: 'Unable to run plagiarism check' });
  }
});

router.post('/suggestion-accepted', async (req, res) => {
  const { documentId, suggestionId } = req.body || {};
  if (!documentId || !suggestionId) return res.status(400).json({ message: 'documentId and suggestionId are required' });
  return res.json({ ok: true });
});

export default router;

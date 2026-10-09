const DEFAULT_SERVER_URL = 'http://localhost:8081';

function getCheckEndpoint() {
  const configured = process.env.LANGUAGETOOL_URL || DEFAULT_SERVER_URL;
  const base = configured.replace(/\/+$/, '');
  return base.endsWith('/v2/check') ? base : `${base}/v2/check`;
}

const PAST_FORMS = {
  am: 'was', is: 'was', are: 'were', go: 'went', goes: 'went', do: 'did', does: 'did',
  have: 'had', has: 'had', take: 'took', takes: 'took', make: 'made', makes: 'made',
  see: 'saw', sees: 'saw', eat: 'ate', eats: 'ate', come: 'came', comes: 'came',
  say: 'said', says: 'said', get: 'got', gets: 'got', write: 'wrote', writes: 'wrote'
};

function chooseContextualReplacement(replacements, source, start, length) {
  const first = String(replacements?.[0]?.value || '').trim();
  if (!first) return '';
  const sentenceStart = Math.max(source.lastIndexOf('.', start), source.lastIndexOf('!', start), source.lastIndexOf('?', start)) + 1;
  const nextStops = ['.', '!', '?'].map((mark) => source.indexOf(mark, start + length)).filter((index) => index >= 0);
  const sentenceEnd = nextStops.length ? Math.min(...nextStops) : source.length;
  const sentence = source.slice(sentenceStart, sentenceEnd);
  const hasPastTimeCue = /\b(?:yesterday|earlier|previously|last\s+(?:night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+\s+(?:days?|weeks?|months?|years?)\s+ago)\b/i.test(sentence);
  if (!hasPastTimeCue) return first;

  const original = source.slice(start, start + length).trim().toLocaleLowerCase();
  const subjectContext = source.slice(sentenceStart, start);
  const pluralSubjectBeforeWas = original === 'was' && /\b(?:they|we|you)\s+(?:\w+\s+){0,2}$/i.test(subjectContext);
  const expectedPast = pluralSubjectBeforeWas ? 'were' : PAST_FORMS[original];
  if (expectedPast) {
    const contextual = replacements.find((item) => String(item?.value || '').trim().toLocaleLowerCase() === expectedPast);
    if (contextual) return String(contextual.value).trim();
  }
  const regularPast = replacements.find((item) => /\b\w+ed\b/i.test(String(item?.value || '').trim()));
  return regularPast ? String(regularPast.value).trim() : first;
}

/**
 * Check text with a self-hosted LanguageTool HTTP server. The public
 * LanguageTool endpoint disallows automated requests, so this app deliberately
 * defaults to localhost. The grammar service handles one Gemini fallback.
 */
export async function checkWithLanguageTool(text) {
  const source = String(text || '').trim().slice(0, 5000);
  if (!source) return [];

  const endpoint = getCheckEndpoint();
  const body = new URLSearchParams({
    text: source,
    language: process.env.LANGUAGETOOL_LANGUAGE || 'en-US'
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw new Error(`LanguageTool is unavailable at ${endpoint}: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`LanguageTool returned HTTP ${response.status}`);
  }

  const result = await response.json();
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return matches.flatMap((match) => {
    const start = Number(match?.offset);
    const length = Number(match?.length);
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1) return [];

    const original = source.slice(start, start + length);
    const suggestion = chooseContextualReplacement(match?.replacements, source, start, length);
    if (!original || !suggestion || original === suggestion) return [];

    const issueType = match?.rule?.issueType;
    const severity = issueType === 'misspelling' || issueType === 'grammar' ? 'medium' : 'low';
    return [{
      original,
      suggestion,
      reason: String(match?.message || 'LanguageTool found a possible improvement.'),
      severity,
      sourceOffset: start,
      source: 'languagetool'
    }];
  }).slice(0, 30);
}

export async function checkLanguageToolHealth() {
  try {
    await checkWithLanguageTool('This is a LanguageTool health check.');
    return true;
  } catch {
    return false;
  }
}

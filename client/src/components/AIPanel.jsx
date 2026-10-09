import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

const DEMO_SCENARIOS = {
  grammar: {
    title: 'Grammar correction', original: 'She go to college every day.',
    suggestion: 'She goes to college every day.', reason: 'Subject–verb agreement: “She” takes “goes”.'
  },
  autocomplete: {
    title: 'Autocomplete', original: 'Artificial intelligence can help students by',
    suggestion: ' improving writing clarity, detecting grammatical mistakes, and suggesting better expressions.'
  },
  rewrite: {
    title: 'Improve writing', original: 'Our system helps people write better and work together on documents.',
    suggestion: 'The system strengthens written communication and enables teams to collaborate on shared documents.'
  },
  paraphrase: {
    title: 'Paraphrase', original: 'The editor saves changes and shares them with collaborators.',
    alternatives: [
      'Edits are saved and made available to every collaborator.',
      'Changes persist in the document and appear for the rest of the team.',
      'The document records each edit and synchronizes it with collaborators.'
    ]
  },
  summarize: {
    title: 'Summarize', original: 'A collaborative document editor lets team members work in one shared space. It synchronizes edits in real time and keeps version history. Access permissions help protect each document.',
    suggestion: 'The editor gives teams a shared space to collaborate, synchronizes changes in real time, and preserves document history. Permissions control who can access each document.'
  },
  similarity: {
    title: 'Reference comparison', original: 'The system synchronizes document edits in real time.',
    suggestion: 'The supplied reference contains similar wording: “Document edits are synchronized in real time across users.”',
    reason: 'Local wording comparison · supplied reference · 1 sentence compared'
  }
};

function ScoreRing({ score }) {
  const radius = 31;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.min(100, Math.max(0, Number(score) || 0));
  const offset = circumference - (safe / 100) * circumference;
  const state = safe >= 70 ? 'high' : safe >= 35 ? 'medium' : 'low';
  return (
    <div className={`ai-score-ring ai-score-${state}`} aria-label={`Average text similarity ${safe}%`}>
      <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} className="ai-ring-track" />
        <circle cx="40" cy="40" r={radius} className="ai-ring-value" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <strong>{safe}%</strong>
      <span>similarity</span>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="ai-toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="ai-toggle" aria-hidden="true"><i /></span>
    </label>
  );
}

function compareSuppliedText(sourceText, referenceText) {
  const tokenize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 1);
  const sentences = (text) => String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => tokenize(item).length > 8);
  const vectorize = (text) => {
    const counts = new Map();
    for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
    const magnitude = Math.sqrt([...counts.values()].reduce((sum, count) => sum + count * count, 0));
    return { counts, magnitude };
  };
  const cosine = (left, right) => {
    if (!left.magnitude || !right.magnitude) return 0;
    let dot = 0;
    for (const [term, count] of left.counts) dot += count * (right.counts.get(term) || 0);
    return dot / (left.magnitude * right.magnitude);
  };

  const sourceSentences = sentences(sourceText);
  const referenceSentences = sentences(referenceText);
  const matches = [];
  const scores = sourceSentences.map((sentence) => {
    const sourceVector = vectorize(sentence);
    let best = null;
    for (const referencePhrase of referenceSentences) {
      const similarity = cosine(sourceVector, vectorize(referencePhrase));
      if (!best || similarity > best.similarity) best = { referencePhrase, similarity };
    }
    const similarity = best?.similarity || 0;
    if (best && similarity >= 0.25) {
      const sourceTerms = new Set(tokenize(sentence));
      matches.push({
        source: 'Supplied reference text',
        url: '',
        match_pct: Math.round(similarity * 100),
        phrase: sentence,
        referencePhrase: best.referencePhrase,
        overlappingPhrases: [...new Set(tokenize(best.referencePhrase))].filter((term) => sourceTerms.has(term))
      });
    }
    return similarity;
  });
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

export default function AIPanel({ user }) {
  const { documentId } = useParams();
  const [activeTab, setActiveTab] = useState('copilot');
  const [selectedText, setSelectedText] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [tone, setTone] = useState('academic');
  const [alternatives, setAlternatives] = useState([]);
  const [rewriteSource, setRewriteSource] = useState('');
  const [rewriteTargetsDocument, setRewriteTargetsDocument] = useState(false);
  const [rewriteDocumentSnapshot, setRewriteDocumentSnapshot] = useState('');
  const [rewriteMode, setRewriteMode] = useState('rewrite');
  const [writingContext, setWritingContext] = useState({ audience: 'general', goal: 'clarity' });
  const [grammarSuggestions, setGrammarSuggestions] = useState([]);
  const [liveGrammar, setLiveGrammar] = useState(null);
  const [summary, setSummary] = useState('');
  const [summarySource, setSummarySource] = useState('');
  const [showReferenceCompare, setShowReferenceCompare] = useState(false);
  const [referenceText, setReferenceText] = useState('');
  const [grammarIndex, setGrammarIndex] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [demoScenario, setDemoScenario] = useState('grammar');
  const [demoText, setDemoText] = useState('She go to college every day.');
  const [demoNotice, setDemoNotice] = useState('');
  const [report, setReport] = useState({ score: 0, matches: [], scannedSentences: 0, provider: 'local' });
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState({
    autocomplete: false,
    grammarAssistant: true,
    plagiarism: true,
    autoParaphrase: false,
    citationFinder: false
  });
  const [providerStatus, setProviderStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/ai/status').then((result) => {
      if (!cancelled) setProviderStatus(result);
    }).catch(() => {
      if (!cancelled) setProviderStatus({ geminiConfigured: false, localGrammarAvailable: false });
    });
    return () => { cancelled = true; };
  }, []);

  const focusText = useMemo(() => selectedText.trim() || documentText.trim(), [selectedText, documentText]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`collab_writing_context_${documentId}`) || '{}');
      setWritingContext({
        audience: ['general', 'instructor', 'team', 'customers'].includes(saved.audience) ? saved.audience : 'general',
        goal: ['clarity', 'professional', 'persuasive', 'concise'].includes(saved.goal) ? saved.goal : 'clarity'
      });
    } catch {
      setWritingContext({ audience: 'general', goal: 'clarity' });
    }
  }, [documentId]);

  function updateWritingContext(field, value) {
    setWritingContext((current) => {
      const next = { ...current, [field]: value };
      try { localStorage.setItem(`collab_writing_context_${documentId}`, JSON.stringify(next)); } catch { /* keep the current session setting */ }
      return next;
    });
  }

  const runAction = useCallback(async (action, providedText = '', options = {}) => {
    const chosenText = String(providedText || selectedText || '').trim();
    const liveEditor = globalThis.document.querySelector('[aria-label="Document editor"]');
    const currentDocumentText = liveEditor ? liveEditor.innerText : (documentText || focusText);
    const text = (chosenText || currentDocumentText).trim();
    const targetsDocument = !chosenText;
    if (!text && action !== 'summarize' && action !== 'plagiarism') {
      setNotice('Select text in the editor first.');
      setActiveTab('copilot');
      return;
    }
    setIsWorking(true);
    setNotice('');
    if (action === 'paraphrase' || action === 'rewrite') {
      setAlternatives([]);
      setRewriteMode(action);
      setRewriteDocumentSnapshot(currentDocumentText.trim());
    }
    try {
      if (action === 'paraphrase' || action === 'rewrite') {
        setRewriteSource(text);
        setRewriteTargetsDocument(targetsDocument);
        const result = await apiFetch('/ai/paraphrase', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, tone, ...writingContext })
        });
        setAlternatives(action === 'rewrite' ? (result.alternatives || []).slice(0, 1) : (result.alternatives || []).slice(0, 3));
        setNotice(result.fallback || !result.alternatives?.length
          ? (result.message || 'AI rewriting is temporarily unavailable. Please try again shortly.')
          : result.alternatives.length < 3
            ? `${result.alternatives.length} complete rewrite${result.alternatives.length === 1 ? '' : 's'} passed the context check. Choose one or try again.`
            : `${tone[0].toUpperCase()}${tone.slice(1)} rewrites are ready. Choose an option to replace the source.`);
        setActiveTab('copilot');
      } else if (action === 'grammar') {
        setGrammarSuggestions([]);
        setGrammarIndex(0);
        const result = await apiFetch('/ai/grammar', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, manual: true })
        });
        setGrammarSuggestions((result.suggestions || []).map((item) => ({
          ...item,
          sourceText: currentDocumentText.trim(),
          documentId: String(documentId)
        })));
        setGrammarIndex(0);
        setNotice(result.message || (result.suggestions?.length
          ? `${result.suggestions.length} grammar suggestion${result.suggestions.length === 1 ? '' : 's'} found by ${result.provider || 'LanguageTool'}.`
          : `No clear grammar issues found by ${result.provider || 'LanguageTool'}.`));
        setActiveTab('copilot');
      } else if (action === 'summarize') {
        const result = await apiFetch('/ai/summarize', {
          method: 'POST',
          body: JSON.stringify({ documentId, text })
        });
        setSummary(result.summary || '');
        setSummarySource(text);
        setNotice(result.fallback
          ? (result.message || 'The AI summary could not be verified. An extractive preview is shown instead.')
          : 'AI summary is ready. Check it against the source before relying on it.');
        setActiveTab('copilot');
      } else if (action === 'translate') {
        const language = window.prompt('Translate selection to which language?', 'English');
        if (!language?.trim()) return;
        const result = await apiFetch('/ai/translate', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, language: language.trim() })
        });
        if (result.translated) {
          replaceSelection(result.translated, text, targetsDocument);
          setNotice(`Translated to ${result.language || language.trim()}.`);
        }
      } else if (action === 'plagiarism') {
        const result = await apiFetch('/ai/plagiarism', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, referenceText: options.referenceText || '' })
        });
        setReport(result || { score: 0, matches: [] });
        setActiveTab('plagiarism');
        window.dispatchEvent(new CustomEvent('editor-plagiarism-result', { detail: result }));
      }
    } catch (error) {
      setNotice(error.message || 'AI request failed');
    } finally {
      setIsWorking(false);
    }
  }, [documentId, documentText, focusText, selectedText, tone, writingContext]);

  useEffect(() => {
    const onSelection = (event) => setSelectedText(event.detail?.text || '');
    const onDocumentText = (event) => setDocumentText(event.detail?.text || '');
    const onPlagiarism = (event) => setReport(event.detail || { score: 0, matches: [] });
    const onGrammar = (event) => {
      setLiveGrammar(event.detail || null);
      if (event.detail) setActiveTab('copilot');
    };
    const onGrammarStatus = (event) => {
      if (event.detail?.message) setNotice(event.detail.message);
      else setNotice((current) => current.startsWith('LanguageTool is unavailable') || current.startsWith('Grammar checking failed') ? '' : current);
    };
    const onCommand = (event) => runAction(event.detail?.action, event.detail?.text || '');
    window.addEventListener('editor-selection', onSelection);
    window.addEventListener('editor-document-text', onDocumentText);
    window.addEventListener('editor-plagiarism-result', onPlagiarism);
    window.addEventListener('editor-grammar-result', onGrammar);
    window.addEventListener('editor-grammar-status', onGrammarStatus);
    window.addEventListener('ai-command', onCommand);
    return () => {
      window.removeEventListener('editor-selection', onSelection);
      window.removeEventListener('editor-document-text', onDocumentText);
      window.removeEventListener('editor-plagiarism-result', onPlagiarism);
      window.removeEventListener('editor-grammar-result', onGrammar);
      window.removeEventListener('editor-grammar-status', onGrammarStatus);
      window.removeEventListener('ai-command', onCommand);
    };
  }, [runAction]);

  function replaceSelection(value, original = '', replaceDocument = false, expectedSourceText = null, expectedDocumentId = null) {
    const detail = { text: value, original, replaceDocument, expectedSourceText, expectedDocumentId, applied: false };
    window.dispatchEvent(new CustomEvent('ai-replace-selection', { detail }));
    setNotice(detail.applied ? 'AI suggestion replaced the source text.' : (detail.reason || 'Could not apply the suggestion. The document changed; try the refreshed suggestion.'));
    if (detail.applied && original && (alternatives.length || replaceDocument)) setAlternatives([]);
    if (detail.applied && original) setLiveGrammar(null);
    return detail.applied;
  }

  function acceptGrammar(issue) {
    if (!issue) return;
    const applied = replaceSelection(issue.suggestion, issue.original, false, issue.sourceText, issue.documentId);
    if (applied) {
      setGrammarSuggestions((items) => items.filter((item) => item !== issue));
      setGrammarIndex(0);
    }
  }

  function rejectGrammar(issue) {
    setGrammarSuggestions((items) => items.filter((item) => item !== issue));
    setGrammarIndex(0);
    if (liveGrammar === issue || (liveGrammar?.original === issue?.original && liveGrammar?.suggestion === issue?.suggestion)) {
      setLiveGrammar(null);
      window.dispatchEvent(new CustomEvent('ai-reject-grammar', { detail: issue }));
    }
  }

  const matchCount = (report.matches || []).length;

  function applyRewrite(value) {
    const applied = replaceSelection(value, rewriteSource, rewriteTargetsDocument, rewriteDocumentSnapshot, documentId);
    if (applied) setAlternatives([]);
  }

  async function regenerateRewrite() {
    if (!rewriteSource) return;
    setIsWorking(true);
    setNotice('Generating a fresh version…');
    try {
      const result = await apiFetch('/ai/paraphrase', {
        method: 'POST',
        body: JSON.stringify({ documentId, text: rewriteSource, tone, ...writingContext })
      });
      const options = result.alternatives || [];
      setAlternatives(rewriteMode === 'rewrite' ? options.slice(0, 1) : options.slice(0, 3));
      setNotice(result.fallback || !options.length ? (result.message || 'The writing provider did not return a new version.') : 'Fresh suggestions are ready.');
    } catch (error) { setNotice(error.message || 'Could not regenerate suggestions.'); }
    finally { setIsWorking(false); }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setNotice('Summary copied to the clipboard.');
    } catch { setNotice('Clipboard access is unavailable in this browser.'); }
  }

  function insertSummary() {
    if (!summary) return;
    window.dispatchEvent(new CustomEvent('ai-insert-text', { detail: { text: `\n${summary}\n` } }));
    setNotice('Summary inserted at the current cursor position.');
  }

  function runReferenceCompare() {
    if (!referenceText.trim()) {
      setNotice('Paste reference text to compare. Nothing has been scanned yet.');
      return;
    }
    const editor = globalThis.document.querySelector('[aria-label="Document editor"]');
    const source = selectedText.trim() || (editor?.innerText || documentText).trim();
    setReport(compareSuppliedText(source, referenceText.trim()));
    setActiveTab('plagiarism');
    setShowReferenceCompare(false);
    setNotice('Compared locally with the reference passage you supplied.');
  }

  function showDemoScenario(name) {
    const scenario = DEMO_SCENARIOS[name];
    setDemoScenario(name);
    setDemoText(scenario.original);
    setDemoNotice(`Sample preview · ${scenario.title}. No provider was called and your document was not changed.`);
  }

  function acceptDemoSuggestion(value) {
    const scenario = DEMO_SCENARIOS[demoScenario];
    if (demoScenario === 'autocomplete') setDemoText(`${scenario.original}${scenario.suggestion}`);
    else if (demoScenario === 'paraphrase') setDemoText(value || scenario.alternatives[0]);
    else setDemoText(value || scenario.suggestion);
    setDemoNotice('Demo accepted in the preview only. Your document is unchanged.');
  }

  function rejectDemoSuggestion() {
    setDemoNotice('Demo suggestion rejected. The preview text remains unchanged; your document is unchanged.');
  }

  function resetDemo() {
    setDemoMode(false);
    setDemoNotice('');
    setDemoText('She go to college every day.');
    setDemoScenario('grammar');
  }

  function selectTone(nextTone) {
    if (nextTone === tone) return;
    setTone(nextTone);
    setAlternatives([]);
    setRewriteSource('');
    setNotice(`Writing tone set to ${nextTone}. Generate a new rewrite to see options in this tone.`);
  }

  return (
    <section className="ai-panel-card">
      <div className="ai-panel-head ai-panel-head-new">
        <div>
        <div className="ai-kicker"><span className="ai-live-dot" /> AI WRITING COPILOT</div>
          <h3>Write with confidence</h3>
          <p>{selectedText ? 'Working with your selection' : 'Grammar, writing help, and reference similarity'}</p>
        </div>
        <span className={`ai-model-badge ${isWorking ? 'working' : ''}`}>{isWorking ? 'WORKING…' : !providerStatus ? 'CHECKING…' : providerStatus.geminiConfigured ? 'GEMINI CONFIGURED' : 'LOCAL TOOLS ONLY'}</span>
      </div>
      {providerStatus && <p className="ai-provider-status" role="status">Local grammar checker: {providerStatus.localGrammarAvailable ? 'available' : 'unavailable'} · Gemini writing provider: {providerStatus.geminiConfigured ? 'configured' : 'not configured'}</p>}

      <div className="ai-mini-tabs ai-mini-tabs-three">
        <button className={activeTab === 'copilot' ? 'active' : ''} onClick={() => setActiveTab('copilot')}>Copilot</button>
        <button className={activeTab === 'plagiarism' ? 'active' : ''} onClick={() => setActiveTab('plagiarism')}>Similarity <span>{report.score}%</span></button>
        <button className={`ai-demo-toggle ${demoMode ? 'active' : ''}`} aria-pressed={demoMode} onClick={() => { if (demoMode) resetDemo(); else { setActiveTab('copilot'); setDemoMode(true); showDemoScenario(demoScenario); } }}>{demoMode ? 'Exit demo' : 'Demo Mode'}</button>
      </div>

      {notice && <div className="ai-notice" role="status">{notice}</div>}

      {activeTab === 'copilot' && (
        <div className="ai-panel-body ai-panel-body-new">
          {demoMode && (
            <section className="ai-demo-card" aria-label="Feature preview">
              <div className="ai-demo-heading"><div><strong>Feature Preview</strong><span>Clearly labeled sample output · your document stays untouched</span></div><button type="button" onClick={resetDemo}>Reset demo</button></div>
              <div className="ai-demo-scenarios">
                {Object.entries(DEMO_SCENARIOS).map(([key, item]) => <button type="button" key={key} className={demoScenario === key ? 'active' : ''} onClick={() => showDemoScenario(key)}>{item.title}</button>)}
              </div>
              <div className="ai-demo-sample-label">SAMPLE PREVIEW · NOT A LIVE AI RESULT</div>
              <div className="ai-demo-text"><small>{DEMO_SCENARIOS[demoScenario].title}</small><p>{demoText}</p></div>
              {demoScenario === 'grammar' && <div className="ai-demo-text ai-demo-proposal"><small>Suggested correction · {DEMO_SCENARIOS.grammar.reason}</small><p>{DEMO_SCENARIOS.grammar.suggestion}</p></div>}
              {demoScenario === 'autocomplete' && <div className="ai-demo-text ai-demo-proposal"><small>Proposed completion</small><p>{DEMO_SCENARIOS.autocomplete.suggestion}</p></div>}
              {demoScenario === 'rewrite' && <div className="ai-demo-text ai-demo-proposal"><small>Improved version</small><p>{DEMO_SCENARIOS.rewrite.suggestion}</p></div>}
              {demoScenario === 'paraphrase' && DEMO_SCENARIOS.paraphrase.alternatives.map((item, index) => <div className="ai-demo-alternative" key={item}><p><b>{index + 1}</b> {item}</p><button type="button" onClick={() => acceptDemoSuggestion(item)}>Apply in preview</button></div>)}
              {demoScenario === 'summarize' && <div className="ai-demo-text ai-demo-proposal"><small>Sample summary</small><p>{DEMO_SCENARIOS.summarize.suggestion}</p></div>}
              {demoScenario === 'similarity' && <div className="ai-demo-text ai-demo-proposal"><small>Local comparison · sample only</small><p>{DEMO_SCENARIOS.similarity.suggestion}</p></div>}
              {demoScenario !== 'paraphrase' && demoScenario !== 'similarity' && <div className="ai-demo-actions"><button type="button" className="accept" onClick={() => acceptDemoSuggestion()}>✓ Accept in preview</button><button type="button" onClick={rejectDemoSuggestion}>✕ Reject</button></div>}
              {demoNotice && <p className="ai-demo-notice" role="status">{demoNotice}</p>}
              <div className="ai-demo-tone"><span>Tone preview</span>{['academic', 'concise', 'casual'].map((item) => <button key={item} type="button" className={tone === item ? 'active' : ''} onClick={() => selectTone(item)}>{item}</button>)}</div>
            </section>
          )}
          {liveGrammar && (
            <div className="ai-live-grammar-card" role="alert">
              <div className="ai-live-grammar-header">
                <div className="ai-live-grammar-icon">Aa</div>
                <div><strong>Grammar suggestion</strong><span>{liveGrammar.source === 'gemini' ? 'Gemini fallback' : 'LanguageTool · detected while you type'}</span></div>
                <button onClick={() => rejectGrammar(liveGrammar)} aria-label="Dismiss grammar suggestion">×</button>
              </div>
              <div className="ai-live-grammar-compare">
                <span className="bad">{liveGrammar.original}</span><span>→</span><span className="good">{liveGrammar.suggestion}</span>
              </div>
              <p>{liveGrammar.reason}</p>
              <div className="ai-live-grammar-actions">
                <button className="accept" onClick={() => acceptGrammar(liveGrammar)}>✓ Accept</button>
                <button className="reject" onClick={() => rejectGrammar(liveGrammar)}>✕ Reject</button>
                <span>Suggestion can be accepted or dismissed</span>
              </div>
            </div>
          )}

          {isWorking && <div className="ai-working-state" role="status"><i /> Contacting the configured writing provider…</div>}
          <div className="ai-action-grid ai-action-grid-new">
            <button disabled={isWorking} onClick={() => runAction('rewrite')}><span className="action-icon violet">✦</span><strong>Improve writing</strong><small>Clarity + stronger flow</small></button>
            <button disabled={isWorking} onClick={() => runAction('paraphrase')}><span className="action-icon cyan">↺</span><strong>Paraphrase</strong><small>Up to three alternatives</small></button>
            <button disabled={isWorking} onClick={() => runAction('grammar')}><span className="action-icon mint">Aa</span><strong>Grammar scan</strong><small>Issues + fixes</small></button>
            <button disabled={isWorking} onClick={() => runAction('summarize')}><span className="action-icon blue">≡</span><strong>Summarize</strong><small>2–3 sentence brief</small></button>
          </div>

          <div className="ai-tone-row ai-tone-row-new">
            <span>Writing tone</span>
            {['academic', 'concise', 'casual'].map((item) => (
              <button key={item} type="button" className={tone === item ? 'active' : ''} aria-pressed={tone === item} onClick={() => selectTone(item)}>{item}</button>
            ))}
          </div>

          <div className="ai-writing-context">
            <div><strong>Writing context</strong><span>Tailor rewrites to your audience and goal</span></div>
            <label>Audience
              <select value={writingContext.audience} onChange={(event) => updateWritingContext('audience', event.target.value)}>
                <option value="general">General reader</option>
                <option value="instructor">University instructor</option>
                <option value="team">Project team</option>
                <option value="customers">Customers</option>
              </select>
            </label>
            <label>Goal
              <select value={writingContext.goal} onChange={(event) => updateWritingContext('goal', event.target.value)}>
                <option value="clarity">Explain clearly</option>
                <option value="professional">Sound professional</option>
                <option value="persuasive">Be persuasive</option>
                <option value="concise">Keep it brief</option>
              </select>
            </label>
          </div>

          {alternatives.length > 0 && (
            <div className="ai-suggestion-section">
              <div className="ai-section-heading">{rewriteMode === 'rewrite' ? 'Improve writing' : 'Paraphrase options'} <span>{alternatives.length} suggestion{alternatives.length === 1 ? '' : 's'}</span></div>
              {rewriteMode === 'rewrite' && <div className="ai-rewrite-comparison"><div><small>Original text</small><p>{rewriteSource}</p></div><div><small>Improved version</small><p>{alternatives[0]}</p></div></div>}
              {alternatives.map((item, index) => rewriteMode === 'rewrite' ? null : (
                <div className="ai-suggestion-card ai-suggestion-card-new" key={`${item}-${index}`}>
                  <div><span className="ai-suggestion-index">{index + 1}</span><span>{item}</span></div>
                  <div className="ai-result-actions"><button className="accept" onClick={() => applyRewrite(item)}>Apply alternative</button><button onClick={() => setAlternatives((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Reject</button></div>
                </div>
              ))}
              {rewriteMode === 'rewrite' && alternatives[0] && <div className="ai-result-actions"><button className="accept" onClick={() => applyRewrite(alternatives[0])}>Accept changes</button><button onClick={() => { setAlternatives([]); setNotice('Suggestion rejected. The original text is unchanged.'); }}>Reject</button><button onClick={regenerateRewrite} disabled={isWorking}>{isWorking ? 'Regenerating…' : 'Regenerate'}</button></div>}
              {rewriteMode === 'paraphrase' && <button className="ai-secondary-action" onClick={regenerateRewrite} disabled={isWorking}>{isWorking ? 'Regenerating…' : 'Regenerate alternatives'}</button>}
            </div>
          )}

          {grammarSuggestions.length > 0 && (
            <div className="ai-suggestion-section">
              <div className="ai-section-heading">Grammar findings <span>{grammarSuggestions.length} issue{grammarSuggestions.length === 1 ? '' : 's'} · {grammarSuggestions[grammarIndex]?.source || 'provider'}</span></div>
              {grammarSuggestions[grammarIndex] && (() => { const item = grammarSuggestions[grammarIndex]; return <div className="ai-grammar-card ai-grammar-card-new" key={`${item.original}-${grammarIndex}`}>
                <div className="ai-grammar-detail"><small>Original text</small><p className="grammar-bad">{item.original}</p><small>Suggested correction</small><p className="grammar-good">{item.suggestion}</p></div>
                <small>{item.reason || 'Possible grammar correction'}</small>
                <div className="grammar-actions"><button onClick={() => acceptGrammar(item)}>✓ Accept</button><button onClick={() => rejectGrammar(item)}>✕ Reject</button></div>
                {grammarSuggestions.length > 1 && <div className="ai-result-actions"><button onClick={() => setGrammarIndex((grammarIndex - 1 + grammarSuggestions.length) % grammarSuggestions.length)}>Previous</button><span>{grammarIndex + 1} / {grammarSuggestions.length}</span><button onClick={() => setGrammarIndex((grammarIndex + 1) % grammarSuggestions.length)}>Next</button></div>}
              </div>; })()}
            </div>
          )}

          {summary && (
            <div className="ai-summary-card ai-summary-card-new">
              <div className="ai-section-heading">Document summary</div>
              <small className="ai-summary-source">{summarySource.length < (documentText || '').trim().length ? 'Summary of selected text' : 'Summary of document'}{summarySource ? ` · ${summarySource.length} characters` : ''}</small>
              <p>{summary}</p>
              <div className="ai-result-actions"><button className="accept" onClick={copySummary}>Copy summary</button><button onClick={insertSummary}>Insert into document</button><button onClick={() => setSummary('')}>Close</button></div>
            </div>
          )}

          <div className="ai-quick-originality">
            <div><span className="mini-orb">◎</span><div><strong>Reference similarity</strong><small>{matchCount} {matchCount === 1 ? 'possible match' : 'possible matches'} · {report.scannedSentences || 0} sentences</small></div></div>
            <button onClick={() => { setShowReferenceCompare(true); setNotice('Compare the current document or selection with text you provide.'); }}>Compare text</button>
          </div>

          <div className="ai-settings ai-settings-new">
            <div className="ai-section-heading">AI controls</div>
            <Toggle label="Autocomplete suggestions" checked={settings.autocomplete} onChange={() => setSettings((current) => { const next = !current.autocomplete; window.dispatchEvent(new CustomEvent('ai-settings-changed', { detail: { autocomplete: next } })); return { ...current, autocomplete: next }; })} />
            <Toggle label="Live grammar assistant" checked={settings.grammarAssistant} onChange={() => setSettings((current) => { const next = !current.grammarAssistant; window.dispatchEvent(new CustomEvent('ai-settings-changed', { detail: { grammarAssistant: next } })); return { ...current, grammarAssistant: next }; })} />
            <Toggle label="Reference similarity check" checked={settings.plagiarism} onChange={() => setSettings((current) => { const next = !current.plagiarism; window.dispatchEvent(new CustomEvent('ai-settings-changed', { detail: { plagiarism: next } })); return { ...current, plagiarism: next }; })} />
          </div>
        </div>
      )}

      {activeTab === 'plagiarism' && (
        <div className="ai-panel-body ai-originality-body">
          <div className="originality-hero">
            <div>
              <span className="originality-eyebrow">REFERENCE SIMILARITY</span>
              <div className="originality-title">{Number(report.score) >= 70 ? 'Many similar words' : Number(report.score) >= 35 ? 'Some similar wording' : 'Little similar wording'}</div>
              <p>{report.provider === 'local-supplied-reference' ? 'Compared locally with the reference passage you supplied. This is not a web search or AI detector.' : 'Average wording similarity against the small reference set bundled with this app. This is not a web search or AI detector.'}</p>
            </div>
            <ScoreRing score={report.score} />
          </div>

          <div className="originality-stats">
            <div><strong>{report.score || 0}%</strong><span>average similarity</span></div>
            <div><strong>{report.scannedSentences || 0}</strong><span>sentences compared</span></div>
            <div><strong>{matchCount}</strong><span>strong matches</span></div>
          </div>

          <div className="originality-actions">
            <button className="ai-primary-btn ai-primary-btn-wide" onClick={() => runAction('plagiarism')} disabled={isWorking}>{isWorking ? 'Comparing…' : 'Compare with references'}</button>
            <button className="ai-secondary-action" onClick={() => setShowReferenceCompare(true)}>Compare with supplied text</button>
            <span className="originality-helper">Bundled corpus comparison is local; supplied-text comparison checks only the text you paste here.</span>
          </div>

          <div className="ai-section-heading">Matched sources</div>
          {(report.matches || []).map((match, index) => (
            <div className="ai-source-card ai-source-card-new" key={`${match.source}-${index}`}>
              <div className="source-topline"><span className="source-number">{index + 1}</span><strong>{match.source}</strong><span>{match.match_pct}%</span></div>
              <div className="source-meter"><span style={{ width: `${Math.min(100, Number(match.match_pct) || 0)}%` }} /></div>
              <p><strong>Document:</strong> {match.phrase}</p>
              {match.referencePhrase && <p><strong>Reference:</strong> {match.referencePhrase}</p>}
              {match.overlappingPhrases?.length > 0 && <p className="ai-overlap-words"><strong>Shared terms:</strong> {match.overlappingPhrases.join(', ')}</p>}
              <div className="source-actions">
                {match.url && <a href={match.url} target="_blank" rel="noreferrer">Open source ↗</a>}
                <button onClick={() => runAction('paraphrase', match.phrase)}>Rewrite matched text</button>
              </div>
            </div>
          ))}

          {(!report.matches || report.matches.length === 0) && (
            <div className="ai-clean-result">
              <div>✓</div>
            <strong>{report.provider === 'local-supplied-reference' ? 'No substantial wording overlap found' : 'No strong matches in the bundled references'}</strong>
            <span>{report.scannedSentences ? 'No matching sentences exceeded the comparison threshold.' : 'Add a longer passage to compare at sentence level.'} This is not a web-wide plagiarism search.</span>
            </div>
          )}

          <div className="plagiarism-disclaimer">This compares wording with a small set of bundled reference text only. It cannot confirm originality, detect AI writing, or check sources across the web.</div>
        </div>
      )}
      {showReferenceCompare && (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowReferenceCompare(false); }}>
          <section className="ai-reference-modal" role="dialog" aria-modal="true" aria-labelledby="ai-reference-title">
            <div className="ai-reference-modal-head"><div><h4 id="ai-reference-title">Compare with supplied text</h4><p>We compare sentence wording locally. This does not search the web or a plagiarism database.</p></div><button type="button" aria-label="Close comparison" onClick={() => setShowReferenceCompare(false)}>×</button></div>
            <label className="ai-reference-label" htmlFor="ai-reference-text">Reference passage</label>
            <textarea id="ai-reference-text" value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="Paste text you have permission to compare against…" maxLength={24000} />
            <div className="ai-reference-footer"><span>{referenceText.length} / 24,000 characters · compares {selectedText ? 'the selected passage' : 'the document'}</span><div><button type="button" onClick={() => setShowReferenceCompare(false)}>Cancel</button><button type="button" className="accept" onClick={runReferenceCompare} disabled={isWorking || !referenceText.trim()}>{isWorking ? 'Comparing…' : 'Compare text'}</button></div></div>
          </section>
        </div>
      )}
    </section>
  );
}

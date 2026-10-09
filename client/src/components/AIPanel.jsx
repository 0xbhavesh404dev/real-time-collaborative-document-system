import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

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

export default function AIPanel({ user }) {
  const { documentId } = useParams();
  const [activeTab, setActiveTab] = useState('copilot');
  const [selectedText, setSelectedText] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [tone, setTone] = useState('academic');
  const [alternatives, setAlternatives] = useState([]);
  const [rewriteSource, setRewriteSource] = useState('');
  const [rewriteTargetsDocument, setRewriteTargetsDocument] = useState(false);
  const [writingContext, setWritingContext] = useState({ audience: 'general', goal: 'clarity' });
  const [grammarSuggestions, setGrammarSuggestions] = useState([]);
  const [liveGrammar, setLiveGrammar] = useState(null);
  const [summary, setSummary] = useState('');
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

  const runAction = useCallback(async (action, providedText = '') => {
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
    if (action === 'paraphrase' || action === 'rewrite') setAlternatives([]);
    try {
      if (action === 'paraphrase' || action === 'rewrite') {
        setRewriteSource(text);
        setRewriteTargetsDocument(targetsDocument);
        const result = await apiFetch('/ai/paraphrase', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, tone, ...writingContext })
        });
        setAlternatives(result.alternatives || []);
        setNotice(result.fallback || !result.alternatives?.length
          ? (result.message || 'AI rewriting is temporarily unavailable. Please try again shortly.')
          : result.alternatives.length < 3
            ? `${result.alternatives.length} complete rewrite${result.alternatives.length === 1 ? '' : 's'} passed the context check. Choose one or try again.`
            : `${tone[0].toUpperCase()}${tone.slice(1)} rewrites are ready. Choose an option to replace the source.`);
        setActiveTab('copilot');
      } else if (action === 'grammar') {
        const result = await apiFetch('/ai/grammar', {
          method: 'POST',
          body: JSON.stringify({ documentId, text, manual: true })
        });
        setGrammarSuggestions((result.suggestions || []).map((item) => ({
          ...item,
          sourceText: currentDocumentText.trim(),
          documentId: String(documentId)
        })));
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
          body: JSON.stringify({ documentId, text })
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
    }
  }

  function rejectGrammar(issue) {
    setGrammarSuggestions((items) => items.filter((item) => item !== issue));
    if (liveGrammar === issue || (liveGrammar?.original === issue?.original && liveGrammar?.suggestion === issue?.suggestion)) {
      setLiveGrammar(null);
      window.dispatchEvent(new CustomEvent('ai-reject-grammar', { detail: issue }));
    }
  }

  const matchCount = (report.matches || []).length;

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
      </div>

      {notice && <div className="ai-notice" role="status">{notice}</div>}

      {activeTab === 'copilot' && (
        <div className="ai-panel-body ai-panel-body-new">
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

          <div className="ai-action-grid ai-action-grid-new">
            <button onClick={() => runAction('rewrite')}><span className="action-icon violet">✦</span><strong>Improve writing</strong><small>Clarity + stronger flow</small></button>
            <button onClick={() => runAction('paraphrase')}><span className="action-icon cyan">↺</span><strong>Paraphrase</strong><small>Up to three alternatives</small></button>
            <button onClick={() => runAction('grammar')}><span className="action-icon mint">Aa</span><strong>Grammar scan</strong><small>Issues + fixes</small></button>
            <button onClick={() => runAction('summarize')}><span className="action-icon blue">≡</span><strong>Summarize</strong><small>2–3 sentence brief</small></button>
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
              <div className="ai-section-heading">Rewrite options <span>Click one to apply</span></div>
              {alternatives.map((item, index) => (
                <button className="ai-suggestion-card ai-suggestion-card-new" key={`${item}-${index}`} onClick={() => replaceSelection(item, rewriteSource, rewriteTargetsDocument)}>
                  <div><span className="ai-suggestion-index">{index + 1}</span><span>{item}</span></div>
                  <small>Apply this version</small>
                </button>
              ))}
            </div>
          )}

          {grammarSuggestions.length > 0 && (
            <div className="ai-suggestion-section">
              <div className="ai-section-heading">Grammar findings <span>{grammarSuggestions.length} issue{grammarSuggestions.length === 1 ? '' : 's'}</span></div>
              {grammarSuggestions.map((item, index) => (
                <div className="ai-grammar-card ai-grammar-card-new" key={`${item.original}-${index}`}>
                  <div className="grammar-line"><span className="grammar-bad">{item.original}</span><span>→</span><strong>{item.suggestion}</strong></div>
                  <small>{item.reason}</small>
                  <div className="grammar-actions"><button onClick={() => acceptGrammar(item)}>Accept</button><button onClick={() => rejectGrammar(item)}>Reject</button></div>
                </div>
              ))}
            </div>
          )}

          {summary && (
            <div className="ai-summary-card ai-summary-card-new">
              <div className="ai-section-heading">Document summary</div>
              <p>{summary}</p>
            </div>
          )}

          <div className="ai-quick-originality">
            <div><span className="mini-orb">◎</span><div><strong>Reference similarity</strong><small>{matchCount} {matchCount === 1 ? 'possible match' : 'possible matches'} · {report.scannedSentences || 0} sentences</small></div></div>
            <button onClick={() => runAction('plagiarism')}>Compare text</button>
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
              <p>Average wording similarity against the small reference set bundled with this app. This is not a web search or AI detector.</p>
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
            <span className="originality-helper">A passage appears below when wording similarity reaches 70%.</span>
          </div>

          <div className="ai-section-heading">Matched sources</div>
          {(report.matches || []).map((match, index) => (
            <div className="ai-source-card ai-source-card-new" key={`${match.source}-${index}`}>
              <div className="source-topline"><span className="source-number">{index + 1}</span><strong>{match.source}</strong><span>{match.match_pct}%</span></div>
              <div className="source-meter"><span style={{ width: `${Math.min(100, Number(match.match_pct) || 0)}%` }} /></div>
              <p>{match.phrase}</p>
              <div className="source-actions">
                <a href={match.url} target="_blank" rel="noreferrer">Open source ↗</a>
                <button onClick={() => runAction('paraphrase', match.phrase)}>Rewrite matched text</button>
              </div>
            </div>
          ))}

          {(!report.matches || report.matches.length === 0) && (
            <div className="ai-clean-result">
              <div>✓</div>
            <strong>No strong matches in the bundled references</strong>
            <span>This result does not check the public web.</span>
            </div>
          )}

          <div className="plagiarism-disclaimer">This compares wording with a small set of bundled reference text only. It cannot confirm originality, detect AI writing, or check sources across the web.</div>
        </div>
      )}
    </section>
  );
}

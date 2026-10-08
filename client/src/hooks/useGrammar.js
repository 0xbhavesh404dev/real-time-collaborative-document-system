import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';

function issueKey(issue, context) {
  return `${String(context || '').slice(-220)}|${issue?.original || ''}|${issue?.suggestion || ''}`;
}

export default function useGrammar({ documentId, text, enabled = true }) {
  const [issue, setIssue] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const suppressedRef = useRef(new Set());
  const requestRef = useRef(0);
  const latestTextRef = useRef(text);
  latestTextRef.current = text;

  const check = useCallback(async (overrideText = text, forced = false) => {
    const source = String(overrideText || '').trim();
    if (!enabled || source.length < 12) {
      requestRef.current += 1;
      setIssue(null);
      setIsChecking(false);
      window.dispatchEvent(new CustomEvent('editor-grammar-result', { detail: null }));
      return null;
    }

    const requestId = ++requestRef.current;
    setIsChecking(true);
    try {
      const result = await apiFetch('/ai/grammar', {
        method: 'POST',
        body: JSON.stringify({ documentId, text: source.slice(-5000) })
      });
      if (requestId !== requestRef.current || String(latestTextRef.current || '').trim() !== source) return null;

      const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
      const matchedIssue = suggestions.find((item) => {
        const original = String(item?.original || '').trim();
        const suggestion = String(item?.suggestion || '').trim();
        if (!original || !suggestion || original === suggestion || !source.includes(original)) return false;
        const key = issueKey({ original, suggestion }, source);
        return forced || !suppressedRef.current.has(key);
      }) || null;
      const nextIssue = matchedIssue ? { ...matchedIssue, sourceText: source, documentId } : null;

      setIssue(nextIssue);
      window.dispatchEvent(new CustomEvent('editor-grammar-result', { detail: nextIssue }));
      return nextIssue;
    } catch {
      if (requestId === requestRef.current) {
        setIssue(null);
        window.dispatchEvent(new CustomEvent('editor-grammar-result', { detail: null }));
      }
      return null;
    } finally {
      if (requestId === requestRef.current) setIsChecking(false);
    }
  }, [documentId, enabled, text]);

  const reject = useCallback(() => {
    if (!issue) return;
    const key = issueKey(issue, text);
    suppressedRef.current.add(key);
    setIssue(null);
  }, [issue, text]);

  const accept = useCallback(() => {
    if (!issue) return null;
    const accepted = issue;
    setIssue(null);
    window.dispatchEvent(new CustomEvent('ai-accept-grammar', { detail: accepted }));
    return accepted;
  }, [issue]);

  useLayoutEffect(() => {
    // Invalidate in-flight requests and remove the old card immediately when
    // the document changes. The next result must match the latest text.
    requestRef.current += 1;
    setIssue(null);
    setIsChecking(false);
    window.dispatchEvent(new CustomEvent('editor-grammar-result', { detail: null }));
  }, [documentId, enabled, text]);

  useEffect(() => {
    if (!enabled || !text?.trim()) return undefined;
    const timer = setTimeout(() => check(), 650);
    return () => clearTimeout(timer);
  }, [check, enabled, text]);

  return { issue, isChecking, check, accept, reject, clear: () => setIssue(null) };
}

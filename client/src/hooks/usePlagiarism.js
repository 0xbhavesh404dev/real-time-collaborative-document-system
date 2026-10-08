import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';

export default function usePlagiarism({ documentId, text, enabled = true }) {
  const [report, setReport] = useState({ score: 0, risk: 0, matches: [], scannedSentences: 0, provider: 'local' });
  const [isChecking, setIsChecking] = useState(false);
  const requestRef = useRef(0);

  const check = useCallback(async (overrideText = text) => {
    const source = String(overrideText || '').trim();
    if (!enabled || source.length < 10) return null;
    const requestId = ++requestRef.current;
    setIsChecking(true);
    try {
      const result = await apiFetch('/ai/plagiarism', {
        method: 'POST',
        body: JSON.stringify({ documentId, text: source })
      });
      if (requestId === requestRef.current) {
        setReport(result);
        window.dispatchEvent(new CustomEvent('editor-plagiarism-result', { detail: result }));
      }
      return result;
    } catch {
      return null;
    } finally {
      if (requestId === requestRef.current) setIsChecking(false);
    }
  }, [documentId, enabled, text]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => check(), 3000);
    return () => clearTimeout(timer);
  }, [check, enabled, text]);

  return { report, isChecking, check };
}

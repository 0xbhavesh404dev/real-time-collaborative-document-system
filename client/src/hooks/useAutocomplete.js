import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';

function contextKey(value) {
  const context = String(value || '').slice(-500).trim();
  return context ? `${context.length}:${context}` : '';
}

export default function useAutocomplete({ documentId, text, enabled = true }) {
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suppressedHash, setSuppressedHash] = useState('');
  const requestRef = useRef(0);
  const latestContextRef = useRef(contextKey(text));
  const suggestionContextRef = useRef('');
  latestContextRef.current = contextKey(text);

  const trigger = useCallback(async (forcedText = text, force = false) => {
    const context = String(forcedText || '').slice(-500).trim();
    const requestedContext = contextKey(context);
    if (!enabled || !context || context.length < 4) {
      requestRef.current += 1;
      suggestionContextRef.current = '';
      setSuggestion('');
      setIsLoading(false);
      return;
    }
    if (!force && requestedContext === suppressedHash) return;

    const requestId = ++requestRef.current;
    suggestionContextRef.current = '';
    setSuggestion('');
    setIsLoading(true);
    try {
      const result = await apiFetch('/ai/autocomplete', {
        method: 'POST',
        body: JSON.stringify({ documentId, text: context })
      });
      if (requestId === requestRef.current && latestContextRef.current === requestedContext) {
        const nextSuggestion = String(result.suggestion || '').trim();
        suggestionContextRef.current = nextSuggestion ? requestedContext : '';
        setSuggestion(nextSuggestion);
      }
    } catch {
      if (requestId === requestRef.current) {
        suggestionContextRef.current = '';
        setSuggestion('');
      }
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [documentId, enabled, suppressedHash, text]);

  const accept = useCallback(() => {
    const value = suggestionContextRef.current === latestContextRef.current ? suggestion : '';
    suggestionContextRef.current = '';
    setSuggestion('');
    if (value) window.dispatchEvent(new CustomEvent('ai-accept-autocomplete', { detail: { text: value } }));
    return value;
  }, [suggestion]);

  const reject = useCallback(() => {
    setSuppressedHash(contextKey(text));
    suggestionContextRef.current = '';
    setSuggestion('');
  }, [text]);

  const clear = useCallback(() => {
    requestRef.current += 1;
    suggestionContextRef.current = '';
    setSuggestion('');
    setIsLoading(false);
  }, []);

  const currentSuggestion = suggestionContextRef.current === latestContextRef.current ? suggestion : '';

  useEffect(() => {
    requestRef.current += 1;
    suggestionContextRef.current = '';
    setSuggestion('');
    setIsLoading(false);
    if (!enabled || !text?.trim()) {
      return undefined;
    }
    const timer = setTimeout(() => trigger(), 600);
    return () => clearTimeout(timer);
  }, [enabled, text, trigger]);

  return {
    suggestion: currentSuggestion,
    isLoading,
    trigger,
    accept,
    reject,
    clear
  };
}

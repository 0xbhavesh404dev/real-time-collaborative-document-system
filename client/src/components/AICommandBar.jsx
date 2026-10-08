export default function AICommandBar({ disabled = false, selectedText = '' }) {
  function command(action) {
    if (disabled) return;
    window.dispatchEvent(new CustomEvent('ai-command', {
      detail: { action, text: selectedText }
    }));
  }

  return (
    <div className="ai-command-bar" role="toolbar" aria-label="AI writing tools">
      <div className="ai-orb" aria-hidden="true">✦</div>
      <div className="ai-command-label">AI Copilot</div>
      <button type="button" onClick={() => command('rewrite')} disabled={disabled} aria-label="Improve writing">Improve</button>
      <button type="button" onClick={() => command('paraphrase')} disabled={disabled}>Paraphrase</button>
      <button type="button" onClick={() => command('grammar')} disabled={disabled}>Grammar</button>
      <button type="button" onClick={() => command('plagiarism')} disabled={disabled}>Plagiarism</button>
      <button type="button" onClick={() => command('summarize')} disabled={disabled}>Summarize</button>
      <span className="ai-divider" />
      <button type="button" onClick={() => command('translate')} disabled={disabled}>Translate</button>
    </div>
  );
}

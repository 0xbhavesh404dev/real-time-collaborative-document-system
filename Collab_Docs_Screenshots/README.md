# Collab Docs feature screenshots

These are screenshots captured from the running application at `http://localhost:5173` using a private demo channel/document (`AI Feature Screenshot Demo` / `AI Feature Demo Draft`). The shared project document was not used for the feature demonstrations.

| File | What it shows | Result source |
|---|---|---|
| `01-editor-overview.png` | Editor, document, formatting toolbar, and AI Writing Copilot | Live app; grammar result from LanguageTool, provider status showed Gemini configured |
| `02-grammar-scan.png` | Grammar issue with original text, suggested correction, explanation, and controls | LanguageTool grammar checker |
| `03-autocomplete.png` | Inline completion preview before acceptance | Gemini provider |
| `04-improve-writing.png` | Original and improved sentence with accept/reject/regenerate actions | Gemini provider |
| `05-paraphrase.png` | Three paraphrase alternatives and apply actions | Gemini provider |
| `06-summarize.png` | Generated summary with Copy and Insert controls | Gemini provider |
| `07-reference-similarity.png` | A supplied reference match showing the document sentence, reference sentence, 100% wording similarity, and shared terms | Local comparison in the live app; no web-wide scan |
| `08-demo-mode.png` | Demo Mode sample scenario and preview | Simulated; the UI labels it “NOT A LIVE AI RESULT” |
| `09-accept-reject.png` | Grammar suggestion card with Accept and Reject controls | LanguageTool grammar checker |
| `10-writing-context.png` | Tone, audience, and goal controls | Live app controls; no generated result |

The reference screenshot uses the private demo document and an intentionally matching passage so the comparison result is easy to explain. The feature compares only the document with text the user supplies (or the small bundled reference set); it is not a web-wide originality or plagiarism search.

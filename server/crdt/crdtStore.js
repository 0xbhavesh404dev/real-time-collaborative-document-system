import { TextCRDT } from './TextCRDT.js';

const activeDocuments = new Map();

// Socket payloads carry document ids as strings while database rows carry numbers.
// Normalising here keeps one authoritative CRDT instance per document.
function keyFor(documentId) {
  return String(documentId);
}

export function getActiveCRDT(documentId, state) {
  const key = keyFor(documentId);
  if (!activeDocuments.has(key)) {
    const crdt = new TextCRDT();
    crdt.loadState(state);
    activeDocuments.set(key, crdt);
  }

  return activeDocuments.get(key);
}

export function hasActiveCRDT(documentId) {
  return activeDocuments.has(keyFor(documentId));
}

export function removeActiveCRDT(documentId) {
  activeDocuments.delete(keyFor(documentId));
}

export function clearActiveCRDTs() {
  activeDocuments.clear();
}

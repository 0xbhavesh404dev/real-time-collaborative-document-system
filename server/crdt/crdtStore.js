import { TextCRDT } from './TextCRDT.js';

const activeDocuments = new Map();

export function getActiveCRDT(documentId, state) {
  if (!activeDocuments.has(documentId)) {
    const crdt = new TextCRDT();
    crdt.loadState(state);
    activeDocuments.set(documentId, crdt);
  }

  return activeDocuments.get(documentId);
}

export function removeActiveCRDT(documentId) {
  activeDocuments.delete(documentId);
}

export function clearActiveCRDTs() {
  activeDocuments.clear();
}

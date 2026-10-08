// Maps a collaborator caret between a plain-text offset and screen coordinates.
// The editor is a contentEditable surface, so a raw DOM offset means nothing to
// another replica; a character offset into the visible text does.

export function getCaretTextOffset(surface) {
  if (!surface) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!surface.contains(range.startContainer)) return null;

  const before = range.cloneRange();
  before.selectNodeContents(surface);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

export function getOffsetRect(surface, offset) {
  if (!surface || !container) return null;
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  let lastTextNode = null;
  let lastOffset = 0;

  while (node) {
    lastTextNode = node;
    lastOffset = node.textContent.length;
    if (remaining <= node.textContent.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && rect.top === 0) return null;
      return rect;
    }
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }

  if (!lastTextNode) return null;
  const range = document.createRange();
  range.setStart(lastTextNode, lastOffset);
  range.collapse(true);
  return range.getBoundingClientRect();
}

// Centralized rich-text formatting helpers for MS Word-like behavior.
// Font size and font family use direct DOM wrapping because execCommand
// is unreliable for these properties across browsers.

export const FONT_SIZES = [
  { label: 'Small (12px)', value: '12px', execValue: '1' },
  { label: 'Normal (16px)', value: '16px', execValue: '3' },
  { label: 'Medium (20px)', value: '20px', execValue: '4' },
  { label: 'Large (24px)', value: '24px', execValue: '5' },
  { label: 'Extra Large (32px)', value: '32px', execValue: '6' },
  { label: 'Huge (40px)', value: '40px', execValue: '7' }
];

export const FONT_FAMILIES = [
  { label: 'Default (Sans)', value: 'inherit' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" }
];

export const LINE_HEIGHTS = [
  { label: '1.0 (Single)', value: '1.0' },
  { label: '1.15 (Tight)', value: '1.15' },
  { label: '1.3 (Normal)', value: '1.3' },
  { label: '1.5 (1.5 lines)', value: '1.5' },
  { label: '1.8 (Spacious)', value: '1.8' },
  { label: '2.0 (Double)', value: '2.0' }
];

export const TEXT_ALIGNMENTS = [
  { label: 'Left', value: 'left', command: 'justifyLeft' },
  { label: 'Center', value: 'center', command: 'justifyCenter' },
  { label: 'Right', value: 'right', command: 'justifyRight' },
  { label: 'Justify', value: 'justify', command: 'justifyFull' }
];

function doc() {
  return (typeof globalThis !== 'undefined' && globalThis.document) || null;
}

/**
 * Wrap the current selection in a <span> with the given inline style.
 * This is the most reliable way to apply font-size / font-family.
 */
export function wrapSelection(styleObj) {
  const document = doc();
  if (!document) return false;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;

  const range = selection.getRangeAt(0);
  // If the selection is empty, create a collapsed range so we can still
  // type into the styled span afterwards.
  if (range.collapsed) {
    const span = document.createElement('span');
    setStyles(span, styleObj);
    range.insertNode(span);
    // Move caret inside the new span
    const newRange = document.createRange();
    newRange.setStart(span, 0);
    newRange.setEnd(span, 0);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return true;
  }

  const fragment = range.extractContents();
  const span = document.createElement('span');
  setStyles(span, styleObj);
  span.appendChild(fragment);
  range.insertNode(span);

  // Restore selection
  const newRange = document.createRange();
  newRange.setStart(span, 0);
  newRange.setEnd(span, span.childNodes.length);
  selection.removeAllRanges();
  selection.addRange(newRange);
  return true;
}

function setStyles(el, styleObj) {
  for (const key in styleObj) {
    el.style[key] = styleObj[key];
  }
}

/**
 * Apply a standard execCommand with CSS styling mode enabled.
 */
export function applyFormat(command, value = null) {
  const document = doc();
  if (!document) return false;
  try {
    document.execCommand('styleWithCSS', false, true);
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/**
 * Changes the font family reliably using inline span wrapping.
 */
export function setFontFamily(family) {
  return wrapSelection({ 'font-family': family });
}

/**
 * Changes font size reliably using inline span wrapping.
 */
export function setFontSize(sizeObj) {
  const px = typeof sizeObj === 'object' ? sizeObj.value : sizeObj;
  return wrapSelection({ 'font-size': px });
}

/**
 * Apply line height reliably using inline span wrapping.
 */
export function setLineHeight(height) {
  return wrapSelection({ 'line-height': height });
}

/**
 * Apply inline style to the current block/container element.
 */
export function setBlockStyle(property, value) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  let container = selection.anchorNode;
  if (container && container.nodeType === 3) {
    container = container.parentElement;
  }
  if (container) {
    container.style[property] = value;
    return true;
  }
  return false;
}

/**
 * Indent or outdent the current selection / block.
 */
export function changeIndent(direction) {
  const document = doc();
  if (!document) return false;
  try {
    return document.execCommand(direction === 'increment' ? 'indent' : 'outdent', false, null);
  } catch {
    return false;
  }
}

/**
 * Insert an image at the current caret position.
 * @param {string} dataUrl - base64 data URL of the image
 * @param {string} alt - alt text for accessibility
 */
export function insertImage(dataUrl, alt = '') {
  const document = doc();
  if (!document) return false;
  try {
    document.execCommand('styleWithCSS', false, true);
    return document.execCommand('insertImage', false, dataUrl);
  } catch {
    return false;
  }
}

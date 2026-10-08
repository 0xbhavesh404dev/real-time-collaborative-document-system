// Client-side CRDT helpers that mirror server/crdt/TextCRDT.js.
// They keep an ordered child index plus cached text so per-keystroke work stays
// linear instead of re-sorting every node for every character.

export function createCrdtState(rawState) {
  const state = {
    nodes: rawState?.nodes || {},
    pendingOperations: rawState?.pendingOperations || {},
    counter: rawState?.counter || 0,
    children: new Map(),
    text: null,
    order: null
  };
  for (const node of Object.values(state.nodes)) {
    const leftId = node.leftId || 'HEAD';
    const siblings = state.children.get(leftId);
    if (siblings) siblings.push(node.id);
    else state.children.set(leftId, [node.id]);
  }
  for (const list of state.children.values()) {
    list.sort();
  }
  return state;
}

function invalidate(state) {
  state.text = null;
  state.order = null;
}

function registerNode(state, id, leftId, value) {
  state.nodes[id] = { id, value, leftId, deleted: false };
  const siblings = state.children.get(leftId);
  if (!siblings) {
    state.children.set(leftId, [id]);
  } else {
    let index = siblings.length;
    while (index > 0 && siblings[index - 1] > id) {
      index -= 1;
    }
    siblings.splice(index, 0, id);
  }
  invalidate(state);
}

function resolvePending(state) {
  let applied = true;
  while (applied) {
    applied = false;
    for (const pending of Object.values(state.pendingOperations)) {
      if (pending.leftId === 'HEAD' || state.nodes[pending.leftId]) {
        delete state.pendingOperations[pending.id];
        registerNode(state, pending.id, pending.leftId || 'HEAD', pending.value);
        applied = true;
      }
    }
  }
}

export function applyRemoteOperation(state, operation) {
  if (!operation || !operation.id) return false;
  if (operation.type === 'insert') {
    if (state.nodes[operation.id] || state.pendingOperations[operation.id]) return false;
    const leftId = operation.leftId || 'HEAD';
    if (leftId !== 'HEAD' && !state.nodes[leftId]) {
      state.pendingOperations[operation.id] = operation;
      return false;
    }
    registerNode(state, operation.id, leftId, operation.value);
    delete state.pendingOperations[operation.id];
    resolvePending(state);
    return true;
  }
  if (operation.type === 'delete') {
    const node = state.nodes[operation.id];
    if (!node || node.deleted) return false;
    node.deleted = true;
    invalidate(state);
    return true;
  }
  return false;
}

export function getOrder(state) {
  if (state.order) return state.order;
  const ordered = [];
  const stack = [{ children: state.children.get('HEAD') || [], index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.children.length) {
      stack.pop();
      continue;
    }
    const id = frame.children[frame.index];
    frame.index += 1;
    const node = state.nodes[id];
    if (!node) continue;
    ordered.push(node);
    const children = state.children.get(id);
    if (children && children.length > 0) {
      stack.push({ children, index: 0 });
    }
  }
  state.order = ordered;
  return ordered;
}

export function visibleNodes(state) {
  return getOrder(state).filter((node) => !node.deleted);
}

export function getText(state) {
  if (state.text === null) {
    state.text = visibleNodes(state).map((node) => node.value).join('');
  }
  return state.text;
}

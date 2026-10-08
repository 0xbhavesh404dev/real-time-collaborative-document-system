export class TextCRDT {
  constructor() {
    this.nodes = {};
    this.pendingOperations = {};
    this.children = new Map();
    this.counter = 0;
    this.textCache = null;
    this.orderCache = null;
    this.tombstones = 0;
  }

  generateId(clientId) {
    this.counter += 1;
    return `${clientId}:${this.counter}`;
  }

  insert(value, leftId = 'HEAD', id) {
    const operationId = id || this.generateId('server');
    return this.applyOperation({
      type: 'insert',
      id: operationId,
      leftId,
      value
    });
  }

  delete(id) {
    return this.applyOperation({ type: 'delete', id });
  }

  applyOperation(operation) {
    if (!operation || !operation.type || !operation.id) {
      return false;
    }

    if (operation.type === 'insert') {
      if (typeof operation.value !== 'string' || operation.value.length !== 1) {
        return false;
      }
      return this.applyInsert(operation);
    }

    if (operation.type === 'delete') {
      return this.applyDelete(operation);
    }

    return false;
  }

  applyInsert(operation) {
    if (this.nodes[operation.id] || this.pendingOperations[operation.id]) {
      return false;
    }

    const leftId = operation.leftId || 'HEAD';
    if (leftId !== 'HEAD' && !this.nodes[leftId]) {
      this.pendingOperations[operation.id] = operation;
      return false;
    }

    this.registerNode(operation.id, leftId, operation.value);
    delete this.pendingOperations[operation.id];
    this.applyReadyPendingOperations();
    return true;
  }

  applyDelete(operation) {
    const node = this.nodes[operation.id];
    if (!node) {
      return false;
    }

    if (node.deleted) {
      return false;
    }

    node.deleted = true;
    this.tombstones += 1;
    this.textCache = null;
    this.orderCache = null;
    return true;
  }

  registerNode(id, leftId, value) {
    this.nodes[id] = { id, value, leftId, deleted: false };
    const siblings = this.children.get(leftId);
    if (!siblings) {
      this.children.set(leftId, [id]);
    } else {
      let index = siblings.length;
      while (index > 0 && siblings[index - 1] > id) {
        index -= 1;
      }
      siblings.splice(index, 0, id);
    }
    this.textCache = null;
    this.orderCache = null;
  }

  applyReadyPendingOperations() {
    let appliedOperation = true;

    while (appliedOperation) {
      appliedOperation = false;
      for (const operation of Object.values(this.pendingOperations)) {
        if (operation.leftId === 'HEAD' || this.nodes[operation.leftId]) {
          delete this.pendingOperations[operation.id];
          this.registerNode(operation.id, operation.leftId || 'HEAD', operation.value);
          appliedOperation = true;
        }
      }
    }
  }

  hasOperation(id) {
    return Boolean(this.nodes[id] || this.pendingOperations[id]);
  }

  getOrder() {
    if (this.orderCache) return this.orderCache;

    const ordered = [];
    const stack = [{ children: this.children.get('HEAD') || [], index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.children.length) {
        stack.pop();
        continue;
      }
      const id = frame.children[frame.index];
      frame.index += 1;
      const node = this.nodes[id];
      if (!node) continue;
      ordered.push(node);
      const children = this.children.get(id);
      if (children && children.length > 0) {
        stack.push({ children, index: 0 });
      }
    }

    this.orderCache = ordered;
    return ordered;
  }

  getVisibleNodes() {
    return this.getOrder().filter((node) => !node.deleted);
  }

  getText() {
    if (this.textCache === null) {
      this.textCache = this.getVisibleNodes().map((node) => node.value).join('');
    }
    return this.textCache;
  }

  compact() {
    const order = this.getOrder();
    const liveCount = order.reduce((count, node) => (node.deleted ? count : count + 1), 0);
    const tombstones = order.length - liveCount;
    if (tombstones <= 200 || tombstones <= 2 * liveCount) {
      return false;
    }
    // Compaction relinks every anchor id, which would invalidate the leftId of
    // still-in-flight operations. Only compact between quiet moments.
    if (Object.keys(this.pendingOperations).length > 0) {
      return false;
    }

    const kept = order.filter((node) => !node.deleted);

    this.nodes = {};
    this.children = new Map();
    this.tombstones = 0;
    let leftId = 'HEAD';
    for (const node of kept) {
      this.registerNode(node.id, leftId, node.value);
      if (node.deleted) {
        this.nodes[node.id].deleted = true;
        this.tombstones += 1;
      }
      leftId = node.id;
    }

    for (const pending of Object.values(this.pendingOperations)) {
      if (pending.leftId !== 'HEAD' && !this.nodes[pending.leftId]) {
        delete this.pendingOperations[pending.id];
      }
    }
    this.textCache = null;
    this.orderCache = null;
    return true;
  }

  getState() {
    return {
      nodes: this.nodes,
      pendingOperations: this.pendingOperations,
      counter: this.counter
    };
  }

  loadState(state = {}) {
    this.nodes = state.nodes || {};
    this.pendingOperations = state.pendingOperations || {};
    this.counter = state.counter || 0;
    this.children = new Map();
    this.tombstones = 0;
    for (const node of Object.values(this.nodes)) {
      const leftId = node.leftId || 'HEAD';
      if (node.deleted) this.tombstones += 1;
      const siblings = this.children.get(leftId);
      if (siblings) siblings.push(node.id);
      else this.children.set(leftId, [node.id]);
    }
    for (const list of this.children.values()) {
      list.sort();
    }
    this.textCache = null;
    this.orderCache = null;
    this.applyReadyPendingOperations();
  }
}

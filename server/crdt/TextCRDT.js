export class TextCRDT {
  constructor() {
    this.nodes = {};
    this.pendingOperations = {};
    this.counter = 0;
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

    this.nodes[operation.id] = {
      id: operation.id,
      value: operation.value,
      leftId,
      deleted: false
    };
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
    return true;
  }

  applyReadyPendingOperations() {
    let appliedOperation = true;

    while (appliedOperation) {
      appliedOperation = false;
      for (const operation of Object.values(this.pendingOperations)) {
        if (operation.leftId === 'HEAD' || this.nodes[operation.leftId]) {
          delete this.pendingOperations[operation.id];
          this.nodes[operation.id] = {
            id: operation.id,
            value: operation.value,
            leftId: operation.leftId || 'HEAD',
            deleted: false
          };
          appliedOperation = true;
        }
      }
    }
  }

  hasOperation(id) {
    return Boolean(this.nodes[id] || this.pendingOperations[id]);
  }

  getVisibleNodes() {
    const orderedNodes = [];

    const addChildren = (leftId) => {
      const children = Object.values(this.nodes)
        .filter((node) => node.leftId === leftId)
        .sort((first, second) => first.id.localeCompare(second.id));

      for (const node of children) {
        orderedNodes.push(node);
        addChildren(node.id);
      }
    };

    addChildren('HEAD');
    return orderedNodes.filter((node) => !node.deleted);
  }

  getText() {
    return this.getVisibleNodes().map((node) => node.value).join('');
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
    this.applyReadyPendingOperations();
  }
}

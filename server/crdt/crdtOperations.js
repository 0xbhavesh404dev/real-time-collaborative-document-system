export function createInsertOperation({ id, leftId = 'HEAD', value }) {
  return {
    type: 'insert',
    id,
    leftId,
    value
  };
}

export function createDeleteOperation(id) {
  return {
    type: 'delete',
    id
  };
}

export function isValidOperation(operation) {
  if (!operation || typeof operation !== 'object') {
    return false;
  }

  if (operation.type === 'insert') {
    return Boolean(
      typeof operation.id === 'string' &&
      operation.id &&
      typeof operation.leftId === 'string' &&
      typeof operation.value === 'string' &&
      operation.value.length === 1
    );
  }

  return Boolean(
    operation.type === 'delete' &&
    typeof operation.id === 'string' &&
    operation.id
  );
}

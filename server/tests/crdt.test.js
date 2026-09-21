import test from 'node:test';
import assert from 'node:assert/strict';
import { TextCRDT } from '../crdt/TextCRDT.js';
import { createInsertOperation, isValidOperation } from '../crdt/crdtOperations.js';

test('inserts characters and materializes visible text', () => {
  const crdt = new TextCRDT();
  crdt.applyOperation(createInsertOperation({ id: 'A:1', value: 'H' }));
  crdt.applyOperation(createInsertOperation({ id: 'A:2', leftId: 'A:1', value: 'i' }));

  assert.equal(crdt.getText(), 'Hi');
});

test('marks deleted characters as tombstones', () => {
  const crdt = new TextCRDT();
  crdt.applyOperation(createInsertOperation({ id: 'A:1', value: 'H' }));
  crdt.delete('A:1');

  assert.equal(crdt.getText(), '');
  assert.equal(crdt.nodes['A:1'].deleted, true);
});

test('ignores duplicate operations', () => {
  const crdt = new TextCRDT();
  const operation = createInsertOperation({ id: 'A:1', value: 'H' });

  assert.equal(crdt.applyOperation(operation), true);
  assert.equal(crdt.applyOperation(operation), false);
  assert.equal(crdt.getText(), 'H');
});

test('orders concurrent siblings deterministically', () => {
  const firstReplica = new TextCRDT();
  const secondReplica = new TextCRDT();
  const first = createInsertOperation({ id: 'A:1', value: 'X' });
  const second = createInsertOperation({ id: 'B:1', value: 'Y' });

  firstReplica.applyOperation(second);
  firstReplica.applyOperation(first);
  secondReplica.applyOperation(first);
  secondReplica.applyOperation(second);

  assert.equal(firstReplica.getText(), 'XY');
  assert.equal(secondReplica.getText(), 'XY');
});

test('holds an insert until its dependency arrives', () => {
  const crdt = new TextCRDT();
  crdt.applyOperation(createInsertOperation({ id: 'A:2', leftId: 'A:1', value: 'i' }));

  assert.equal(crdt.getText(), '');
  assert.equal(Boolean(crdt.pendingOperations['A:2']), true);

  crdt.applyOperation(createInsertOperation({ id: 'A:1', value: 'H' }));
  assert.equal(crdt.getText(), 'Hi');
});

test('serializes and loads state', () => {
  const original = new TextCRDT();
  original.applyOperation(createInsertOperation({ id: 'A:1', value: 'O' }));
  original.applyOperation(createInsertOperation({ id: 'A:2', leftId: 'A:1', value: 'K' }));

  const restored = new TextCRDT();
  restored.loadState(JSON.parse(JSON.stringify(original.getState())));

  assert.equal(restored.getText(), 'OK');
  assert.deepEqual(restored.getState().nodes, original.getState().nodes);
});

test('validates the simple operation format', () => {
  assert.equal(isValidOperation({ type: 'insert', id: 'A:1', leftId: 'HEAD', value: 'a' }), true);
  assert.equal(isValidOperation({ type: 'insert', id: 'A:1', leftId: 'HEAD', value: 'ab' }), false);
  assert.equal(isValidOperation({ type: 'delete', id: 'A:1' }), true);
});

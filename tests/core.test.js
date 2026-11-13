import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lines,
  diff,
  merge,
  resolve,
  editedText,
  endingStyle,
  validateSession,
  EXAMPLES,
} from '../core.js';
function lcs(a, b, i = 0, j = 0, memo = new Map()) {
  if (i === a.length || j === b.length) return 0;
  const key = i + ',' + j;
  if (memo.has(key)) return memo.get(key);
  const result =
    a[i] === b[j]
      ? 1 + lcs(a, b, i + 1, j + 1, memo)
      : Math.max(lcs(a, b, i + 1, j, memo), lcs(a, b, i, j + 1, memo));
  memo.set(key, result);
  return result;
}
test('line tokens preserve LF, CRLF, CR, empty input, and final newlines', () => {
  for (const value of ['', 'a', 'a\n', 'a\r\n', '\n\n', 'a\rb\r', 'a\r\nb\nc'])
    assert.equal(lines(value).join(''), value);
  assert.deepEqual(lines('a\n'), ['a\n']);
  assert.equal(endingStyle('a\r\nb\n'), 'mixed');
});
test('diff scripts reconstruct both inputs and have minimum insertion/deletion count', () => {
  let seed = 67;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 300; trial++) {
    const a = Array.from({ length: random(10) }, () => String(random(4)) + '\n'),
      b = Array.from({ length: random(10) }, () => String(random(4)) + '\n'),
      result = diff(a.join(''), b.join(''));
    assert.equal(
      result.operations
        .filter((o) => o.type !== 'insert')
        .map((o) => o.text)
        .join(''),
      a.join(''),
    );
    assert.equal(
      result.operations
        .filter((o) => o.type !== 'delete')
        .map((o) => o.text)
        .join(''),
      b.join(''),
    );
    assert.equal(result.inserted + result.deleted, a.length + b.length - 2 * lcs(a, b));
  }
});
test('independent and identical edits merge without conflict', () => {
  const independent = merge(EXAMPLES.independent);
  assert.equal(independent.conflicts.length, 0);
  assert.equal(
    resolve(independent).text,
    'name: evening-service\nport: 8080\nlogging: basic\ncache: on\n',
  );
  const same = merge({ base: 'a\nb\n', ours: 'a\nB\n', theirs: 'a\nB\n' });
  assert.equal(resolve(same).text, 'a\nB\n');
  assert.equal(same.conflicts.length, 0);
});
test('unchanged-side identity holds over repeated lines and arbitrary replacements', () => {
  for (const base of ['', 'a', 'a\na\nb\n', 'x\r\ny\r\n'])
    for (const changed of ['', 'changed', 'a\nb\na\n', 'x\r\nz']) {
      assert.equal(resolve(merge({ base, ours: changed, theirs: base })).text, changed);
      assert.equal(resolve(merge({ base, ours: base, theirs: changed })).text, changed);
    }
});
test('overlapping edits produce a precise conflict with three source versions', () => {
  const result = merge(EXAMPLES.conflict);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0], {
    id: 0,
    start: 1,
    end: 2,
    base: 'status: draft\n',
    ours: 'status: ready\n',
    theirs: 'status: review\n',
  });
  assert.equal(resolve(result).unresolved, 1);
  assert.ok(resolve(result).text.includes('||||||| BASE\nstatus: draft'));
});
test('same-position insertions conflict and identical insertions merge once', () => {
  const result = merge(EXAMPLES.insertion);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].base, '');
  const same = merge({ ...EXAMPLES.insertion, theirs: EXAMPLES.insertion.ours });
  assert.equal(resolve(same).text, EXAMPLES.insertion.ours);
});
test('adjacent replacements merge while boundary insertions are conservatively grouped', () => {
  const adjacent = merge({ base: 'a\nb\n', ours: 'A\nb\n', theirs: 'a\nB\n' });
  assert.equal(adjacent.conflicts.length, 0);
  assert.equal(resolve(adjacent).text, 'A\nB\n');
  const boundary = merge({ base: 'a\nb\n', ours: 'A\nb\n', theirs: 'a\nx\nb\n' });
  assert.equal(boundary.conflicts.length, 1);
});
test('deletion versus modification conflicts and overlapping groups coalesce transitively', () => {
  const deletion = merge({ base: 'a\nb\nc\n', ours: 'a\nc\n', theirs: 'a\nB\nc\n' });
  assert.equal(deletion.conflicts.length, 1);
  assert.equal(deletion.conflicts[0].ours, '');
  const wide = merge({
    base: 'a\nb\nc\nd\ne\n',
    ours: 'a\nB\nc\nD\ne\n',
    theirs: 'a\nreplacement\ne\n',
  });
  assert.equal(wide.conflicts.length, 1);
  assert.equal(wide.conflicts[0].ours, 'B\nc\nD\n');
});
test('resolution choices and manual text preserve exact endings', () => {
  const result = merge({ base: 'a\r\nb', ours: 'a\r\nours', theirs: 'a\r\ntheirs' });
  assert.equal(resolve(result, { 0: { choice: 'ours' } }).text, 'a\r\nours');
  assert.equal(resolve(result, { 0: { choice: 'theirs' } }).text, 'a\r\ntheirs');
  assert.equal(resolve(result, { 0: { choice: 'base' } }).text, 'a\r\nb');
  assert.equal(resolve(result, { 0: { choice: 'manual', text: 'custom' } }).text, 'a\r\ncustom');
  assert.ok(resolve(result).text.includes('<<<<<<< OURS\r\n'));
});
test('editing preserves uniform newline styles and documents mixed normalization', () => {
  assert.equal(editedText('a\r\nb\r\n', 'a\nB\n'), 'a\r\nB\r\n');
  assert.equal(editedText('a\rb\r', 'A\nb\n'), 'A\rb\r');
  assert.equal(editedText('a\r\nb\n', 'a\nB\n'), 'a\nB\n');
});
test('session validation rejects stale resolutions and oversized inputs', () => {
  const result = merge(EXAMPLES.conflict);
  assert.throws(() => resolve(result, { 1: { choice: 'ours' } }));
  assert.throws(() => resolve(result, { 0: { choice: 'manual', text: 'x'.repeat(100001) } }));
  assert.throws(() => lines('x\n'.repeat(801)));
  assert.throws(() => lines('x\0'));
  assert.throws(() => validateSession({ sources: EXAMPLES.conflict, resolutions: {}, extra: 1 }));
  const saved = {
    sources: EXAMPLES.conflict,
    resolutions: { 0: { choice: 'manual', text: 'status: accepted\n' } },
  };
  assert.equal(resolve(validateSession(saved).result, saved.resolutions).unresolved, 0);
});
test('merge is deterministic and does not mutate source objects', () => {
  const input = structuredClone(EXAMPLES.conflict),
    before = structuredClone(input);
  assert.deepEqual(merge(input), merge(input));
  assert.deepEqual(input, before);
});

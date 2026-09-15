import assert from 'node:assert/strict';
import test from 'node:test';
import { matchGroupsByNames, parsePastedGroupNames } from './groupNameSearch.ts';

test('parses Excel rows and columns into unique group-name searches', () => {
  assert.deepEqual(parsePastedGroupNames(' Class A \r\nClass B\tClass C\nclass a\n\n'), [
    'Class A',
    'Class B',
    'Class C',
  ]);
});

test('matches every pasted name case-insensitively and reports names with no result', () => {
  const result = matchGroupsByNames(
    [
      { id: '1', name: 'Class A - Parents' },
      { id: '2', name: 'Class B - Teachers' },
      { id: '3', name: 'Sports Club' },
    ],
    ['class a', 'CLASS B', 'Missing Group'],
  );

  assert.deepEqual(
    result.matchedGroups.map(group => group.id),
    ['1', '2'],
  );
  assert.deepEqual(result.matchedNames, ['class a', 'CLASS B']);
  assert.deepEqual(result.unmatchedNames, ['Missing Group']);
});

test('one pasted name can find multiple groups using partial-name matching', () => {
  const result = matchGroupsByNames(
    [
      { id: '1', name: 'Grade 1 Parents' },
      { id: '2', name: 'Grade 2 Parents' },
      { id: '3', name: 'Grade 1 Teachers' },
    ],
    ['Parents'],
  );

  assert.deepEqual(
    result.matchedGroups.map(group => group.id),
    ['1', '2'],
  );
});

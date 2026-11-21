import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachableFromDefault } from '../lib/upstream.mjs';

// compare API の default...commit の status。commit が既定ブランチの祖先（behind / identical）でなければ、fork ネットワークの
// impostor commit などかもしれないので止める。
test('reachableFromDefault: 既定ブランチから到達できる commit だけを受け付ける', () => {
  assert.equal(reachableFromDefault('behind'), true);
  assert.equal(reachableFromDefault('identical'), true);
  assert.equal(reachableFromDefault('ahead'), false);
  assert.equal(reachableFromDefault('diverged'), false);
});

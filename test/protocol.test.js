import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BRIDGE_NAME,
  BRIDGE_VERSION,
  META_KEY,
  META_PROTOCOL,
} from '../lib/protocol.js';

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

test('BRIDGE_VERSION is the package version', () => {
  assert.equal(BRIDGE_VERSION, manifest.version);
});

test('BRIDGE_NAME is the package name', () => {
  assert.equal(BRIDGE_NAME, manifest.name);
});

test('package name is unscoped and publishable', () => {
  assert.equal(manifest.name, 'dsh-qwenpaw-bridge');
  assert.equal(manifest.name.startsWith('@'), false);
});

test('_meta protocol vocabulary is stable', () => {
  assert.equal(META_KEY, 'qwenpaw');
  assert.equal(META_PROTOCOL, 1);
});

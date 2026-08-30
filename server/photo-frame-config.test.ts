import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createR2PhotoStorage, getR2Origin} from './photo-storage.js';

test('R2 dependencies and adapter use the private S3 endpoint with bounded operations', async () => {
  const [packageJson, storage] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('server/photo-storage.ts', 'utf8'),
  ]);
  assert.match(packageJson, /"@aws-sdk\/client-s3"/);
  assert.match(packageJson, /"@aws-sdk\/s3-request-presigner"/);
  assert.match(packageJson, /"sharp"/);
  assert.match(packageJson, /"busboy"/);
  assert.match(storage, /region: 'auto'/);
  assert.match(storage, /forcePathStyle: true/);
  assert.match(storage, /https:\/\/\$\{accountId\}\.r2\.cloudflarestorage\.com/);
  assert.match(storage, /PutObjectCommand/);
  assert.match(storage, /ContentType: 'image\/webp'/);
  assert.match(storage, /IfNoneMatch: '\*'/);
  assert.match(storage, /AbortSignal\.timeout\(STORAGE_TIMEOUT_MS\)/);
  assert.match(storage, /expiresIn: SIGNED_READ_EXPIRY_SECONDS/);
  assert.doesNotMatch(storage, /public-read|custom domain/i);
});

test('presigned reads stay on the exact CSP account origin and expire in 30 minutes', async () => {
  const config = {
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'photo-frame-test',
  };
  const signed = new URL(await createR2PhotoStorage(config).signReadUrl(
    'photo-frames/77/12345678-1234-4123-8123-123456789abc.webp',
  ));
  assert.equal(signed.origin, getR2Origin(config.accountId));
  assert.equal(
    signed.pathname,
    '/photo-frame-test/photo-frames/77/12345678-1234-4123-8123-123456789abc.webp',
  );
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '1800');
  assert.doesNotMatch(signed.href, /test-secret-key/);
});

test('R2 environment is server-only, complete-or-absent, and documented with placeholders', async () => {
  const [config, example] = await Promise.all([
    readFile('server/config.ts', 'utf8'),
    readFile('.env.example', 'utf8'),
  ]);
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    assert.match(config, new RegExp(`'${name}'`));
    assert.match(example, new RegExp(`^${name}=replace-with-`, 'm'));
    assert.doesNotMatch(example, new RegExp(`^VITE_${name}=`, 'm'));
  }
  assert.match(config, /R2 configuration is incomplete/);
});

test('server permits exact configured R2 image origin and never proxies image downloads', async () => {
  const app = await readFile('server/app.ts', 'utf8');
  assert.match(app, /config\.r2 \? \[getR2Origin\(config\.r2\.accountId\)\] : \[\]/);
  assert.doesNotMatch(app, /https:\/\/\*\.r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(app, /app\.get\(['"]\/api\/board\/photo-frames\/.*image/);
});

import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import type {AppConfig} from './config.js';
import {MAX_PHOTO_UPLOAD_BYTES} from './photo-image.js';
import type {PhotoStorage, SanitizedPhoto} from './photo-storage.js';
import {PhotoStorageError} from './photo-storage.js';

const USER_ID = '123456789';
const OWNED_ITEM_ID = '77';
const SANITIZED_BYTES = Buffer.from('gostudy-sanitized-webp');

type PoolHandler = (text: string, values: unknown[]) => QueryResultRow[];

function createPool(handler: PoolHandler = () => []): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      const rows = handler(text, values);
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

function createConfig(r2 = false): AppConfig {
  return {
    nodeEnv: 'test',
    appUrl: new URL('http://localhost:3000'),
    port: 0,
    databaseUrl: 'postgresql://unused',
    databaseSsl: false,
    pgPoolMax: 1,
    discordClientId: '123456789',
    discordClientSecret: 'test-only',
    discordRedirectUri: 'http://localhost:3000/auth/discord/callback',
    sessionSecret: 'test-session-secret-that-is-at-least-32-characters',
    sessionTtlSeconds: 604_800,
    trustProxy: false,
    r2: r2 ? {
      accountId: '0123456789abcdef0123456789abcdef',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      bucket: 'photo-frame-test',
    } : null,
  };
}

async function setSession(store: session.MemoryStore, sessionId: string): Promise<void> {
  const cookie = new session.Cookie();
  cookie.httpOnly = true;
  cookie.path = '/';
  cookie.maxAge = 604_800_000;
  await new Promise<void>((resolve, reject) => {
    store.set(sessionId, {
      cookie,
      discordUserId: USER_ID,
      username: 'photo-route-user',
      globalName: null,
      avatarHash: null,
    }, (error) => error ? reject(error) : resolve());
  });
}

function sessionCookie(sessionId: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return `gostudy.sid=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

async function withServer(
  pool: Pool,
  storage: PhotoStorage | null,
  run: (baseUrl: string, authHeaders: Record<string, string>) => Promise<void>,
  options: {
    normalizePhoto?: (input: Buffer) => Promise<SanitizedPhoto>;
    r2?: boolean;
  } = {},
): Promise<void> {
  const config = createConfig(options.r2);
  const store = new session.MemoryStore();
  const sessionId = `photo-route-${Math.random()}`;
  await setSession(store, sessionId);
  const server = createApp(config, pool, {
    sessionStore: store,
    photoStorage: storage,
    normalizePhoto: options.normalizePhoto,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, {
      Cookie: sessionCookie(sessionId, config.sessionSecret),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function photoForm(bytes = Buffer.from('raw-user-file')): FormData {
  const form = new FormData();
  form.append('image', new Blob([bytes], {type: 'image/png'}), 'ignored-user-name.png');
  return form;
}

function ownershipRow() {
  return [{item_key: 'photo-frame', item_type: 'photo_frame'}];
}

function normalizedPhoto(): SanitizedPhoto {
  return {
    bytes: SANITIZED_BYTES,
    width: 640,
    height: 480,
    byteSize: SANITIZED_BYTES.length,
    contentSha256: 'a'.repeat(64),
  };
}

function successfulPool(events: string[], oldObjectKey: string | null = null): Pool {
  return createPool((text, values) => {
    if (text.includes('SELECT owned.item_key') && text.includes('catalog.item_type')) {
      events.push('ownership');
      assert.deepEqual(values, [USER_ID, OWNED_ITEM_ID]);
      return ownershipRow();
    }
    if (text.includes('web_replace_photo_frame_image')) {
      events.push('database');
      assert.equal(values[0], OWNED_ITEM_ID);
      assert.equal(values[1], USER_ID);
      assert.match(String(values[2]), /^photo-frames\/77\/[0-9a-f-]{36}\.webp$/);
      assert.equal(values[3], 640);
      assert.equal(values[4], 480);
      assert.equal(values[5], SANITIZED_BYTES.length);
      assert.equal(values[6], 'a'.repeat(64));
      return [{
        owned_itemid: OWNED_ITEM_ID,
        object_key: values[2],
        width: 640,
        height: 480,
        byte_size: SANITIZED_BYTES.length,
        content_sha256: 'a'.repeat(64),
        revision: values[7] === '0' ? '1' : String(BigInt(String(values[7])) + 1n),
        old_object_key: oldObjectKey,
      }];
    }
    throw new Error(`Unexpected query: ${text}`);
  });
}

function recordingStorage(events: string[], deleted: string[] = []): PhotoStorage {
  return {
    async putSanitizedImage(key, photo) {
      events.push('put');
      assert.match(key, /^photo-frames\/77\/[0-9a-f-]{36}\.webp$/);
      assert.deepEqual(photo.bytes, SANITIZED_BYTES);
      assert.notDeepEqual(photo.bytes, Buffer.from('raw-user-file'));
    },
    async deleteObject(key) {
      events.push('delete');
      deleted.push(key);
    },
    async signReadUrl(key) {
      events.push('sign');
      return `https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/signed/${encodeURIComponent(key)}`;
    },
  };
}

test('Photo Frame upload requires authentication before parsing or database access', async () => {
  let queried = false;
  const config = createConfig();
  const server = createApp(config, createPool(() => { queried = true; return []; }), {
    sessionStore: new session.MemoryStore(),
    photoStorage: recordingStorage([]),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/board/photo-frames/77/image`,
      {method: 'PUT'},
    );
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(queried, false);
});

test('upload requires exact Origin, multipart, and a canonical optimistic revision', async () => {
  let queried = false;
  await withServer(
    createPool(() => { queried = true; return ownershipRow(); }),
    recordingStorage([]),
    async (baseUrl, authHeaders) => {
      const noOrigin = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, 'X-Photo-Revision': '0'},
        body: photoForm(),
      });
      assert.equal(noOrigin.status, 403);

      const wrongType = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
          'X-Photo-Revision': '0',
        },
        body: '{}',
      });
      assert.equal(wrongType.status, 415);

      const badRevision = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '01'},
        body: photoForm(),
      });
      assert.equal(badRevision.status, 400);
    },
  );
  assert.equal(queried, false);
});

test('ownership and exact photo-frame type are checked before image processing', async () => {
  for (const [rows, status, code] of [
    [[], 404, 'PHOTO_FRAME_NOT_FOUND'],
    [[{item_key: 'sticky-note', item_type: 'sticky_note'}], 409, 'BOARD_ITEM_NOT_PHOTO_FRAME'],
  ] as const) {
    let normalized = false;
    await withServer(
      createPool((text) => {
        assert.match(text, /web_owned_board_items/);
        return [...rows];
      }),
      recordingStorage([]),
      async (baseUrl, authHeaders) => {
        const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
          method: 'PUT',
          headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '0'},
          body: photoForm(),
        });
        assert.equal(response.status, status);
        assert.equal((await response.json() as {code: string}).code, code);
      },
      {normalizePhoto: async () => { normalized = true; return normalizedPhoto(); }},
    );
    assert.equal(normalized, false);
  }
});

test('multipart parser rejects unexpected fields, multiple files, and files over 5 MiB', async () => {
  let mutations = 0;
  const pool = createPool((text) => {
    if (text.includes('SELECT owned.item_key')) return ownershipRow();
    mutations += 1;
    return [];
  });
  await withServer(pool, recordingStorage([]), async (baseUrl, authHeaders) => {
    const headers = {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '0'};

    const fieldForm = photoForm();
    fieldForm.append('userid', '999');
    assert.equal((await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
      method: 'PUT', headers, body: fieldForm,
    })).status, 400);

    const multiple = photoForm();
    multiple.append('image', new Blob([Buffer.from('second')], {type: 'image/png'}), 'second.png');
    assert.equal((await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
      method: 'PUT', headers, body: multiple,
    })).status, 400);

    const tooLarge = photoForm(Buffer.alloc(MAX_PHOTO_UPLOAD_BYTES + 1));
    assert.equal((await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
      method: 'PUT', headers, body: tooLarge,
    })).status, 413);
  });
  assert.equal(mutations, 0);
});

test('successful upload stores only normalized bytes, commits, signs, and exposes no object key', async () => {
  const events: string[] = [];
  await withServer(
    successfulPool(events),
    recordingStorage(events),
    async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '0'},
        body: photoForm(),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.ownedItemId, OWNED_ITEM_ID);
      assert.match(JSON.stringify(body), /"revision":"1"/);
      assert.doesNotMatch(JSON.stringify(body), /objectKey|object_key|accessKey|secret|ignored-user-name/);
    },
    {
      normalizePhoto: async (input) => {
        events.push('normalize');
        assert.deepEqual(input, Buffer.from('raw-user-file'));
        return normalizedPhoto();
      },
    },
  );
  assert.deepEqual(events, ['ownership', 'normalize', 'put', 'database', 'sign']);
});

test('failed DB mutation deletes the new object and stale revisions return 409', async () => {
  const events: string[] = [];
  const deleted: string[] = [];
  const pool = createPool((text) => {
    if (text.includes('SELECT owned.item_key')) {
      events.push('ownership');
      return ownershipRow();
    }
    if (text.includes('web_replace_photo_frame_image')) {
      events.push('database');
      throw Object.assign(new Error('stale'), {code: 'GSP03'});
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  await withServer(
    pool,
    recordingStorage(events, deleted),
    async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '4'},
        body: photoForm(),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json() as {code: string}).code, 'PHOTO_REVISION_CONFLICT');
    },
    {normalizePhoto: async () => normalizedPhoto()},
  );
  assert.deepEqual(events, ['ownership', 'put', 'database', 'delete']);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /^photo-frames\/77\//);
});

test('successful replacement deletes the old object only after DB mutation', async () => {
  const events: string[] = [];
  const deleted: string[] = [];
  const oldKey = 'photo-frames/77/11111111-1111-4111-8111-111111111111.webp';
  await withServer(
    successfulPool(events, oldKey),
    recordingStorage(events, deleted),
    async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '6'},
        body: photoForm(),
      });
      assert.equal(response.status, 200);
      assert.match(JSON.stringify(await response.json()), /"revision":"7"/);
    },
    {normalizePhoto: async () => normalizedPhoto()},
  );
  assert.deepEqual(events, ['ownership', 'put', 'database', 'delete', 'sign']);
  assert.deepEqual(deleted, [oldKey]);
});

test('old-object deletion failure does not roll back or hide a successful replacement', async () => {
  const events: string[] = [];
  const oldKey = 'photo-frames/77/11111111-1111-4111-8111-111111111111.webp';
  const storage: PhotoStorage = {
    async putSanitizedImage() { events.push('put'); },
    async deleteObject(key) {
      events.push('delete');
      assert.equal(key, oldKey);
      throw new PhotoStorageError('delete');
    },
    async signReadUrl() {
      events.push('sign');
      return 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/signed';
    },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await withServer(
      successfulPool(events, oldKey),
      storage,
      async (baseUrl, authHeaders) => {
        const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
          method: 'PUT',
          headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '2'},
          body: photoForm(),
        });
        assert.equal(response.status, 200);
        assert.match(JSON.stringify(await response.json()), /"revision":"3"/);
      },
      {normalizePhoto: async () => normalizedPhoto()},
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(events, ['ownership', 'put', 'database', 'delete', 'sign']);
});

test('a fake browser image media type cannot bypass authoritative decoding', async () => {
  const events: string[] = [];
  await withServer(
    createPool((text) => text.includes('SELECT owned.item_key') ? ownershipRow() : []),
    recordingStorage(events),
    async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '0'},
        body: photoForm(Buffer.from('definitely not a PNG')),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as {code: string}).code, 'INVALID_PHOTO_IMAGE');
    },
  );
  assert.deepEqual(events, []);
});

test('storage failures are safe and CSP adds only the configured exact R2 origin', async () => {
  const storage: PhotoStorage = {
    async putSanitizedImage() {
      throw new PhotoStorageError('put');
    },
    async deleteObject() {},
    async signReadUrl() { return 'unused'; },
  };
  await withServer(
    createPool((text) => text.includes('SELECT owned.item_key') ? ownershipRow() : []),
    storage,
    async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/photo-frames/77/image`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'X-Photo-Revision': '0'},
        body: photoForm(),
      });
      assert.equal(response.status, 503);
      assert.doesNotMatch(JSON.stringify(await response.json()), /credential|access|secret|bucket/i);
      const csp = response.headers.get('content-security-policy') ?? '';
      assert.match(csp, /img-src[^;]*https:\/\/0123456789abcdef0123456789abcdef\.r2\.cloudflarestorage\.com/);
      assert.doesNotMatch(csp, /https:\/\/\*\.r2\.cloudflarestorage\.com/);
    },
    {normalizePhoto: async () => normalizedPhoto(), r2: true},
  );
});

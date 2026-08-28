import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  getNewRewardIds,
  markRewardsSeen,
} from './productData.js';

test('rendered page selection includes only that page new reward instances', () => {
  const pageOne = [
    {hourRewardId: '100', isNew: true},
    {hourRewardId: '99', isNew: false},
  ];
  const unloadedPageTwo = [
    {hourRewardId: '98', isNew: true},
    {hourRewardId: '97', isNew: true},
  ];

  assert.deepEqual(getNewRewardIds(pageOne), ['100']);
  assert.deepEqual(getNewRewardIds(unloadedPageTwo), ['98', '97']);
  assert(!getNewRewardIds(pageOne).includes('98'));
});

test('a reward arriving after page selection is not added to the captured batch', () => {
  const renderedItems = [{hourRewardId: '100', isNew: true}];
  const capturedRewardIds = getNewRewardIds(renderedItems);
  const rewardArrivingLater = {hourRewardId: '101', isNew: true};

  assert.deepEqual(capturedRewardIds, ['100']);
  assert(!capturedRewardIds.includes(rewardArrivingLater.hourRewardId));
});

test('mark-seen posts exactly the rendered IDs without mutating badge state', async () => {
  const originalFetch = globalThis.fetch;
  const renderedItems = [
    {hourRewardId: '100', isNew: true},
    {hourRewardId: '99', isNew: false},
  ];
  let request: {input: string; init?: RequestInit} | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = {input: String(input), init};
    return new Response(JSON.stringify({success: true}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;

  try {
    await markRewardsSeen(getNewRewardIds(renderedItems));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request?.input, '/api/rewards/seen');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(request?.init?.credentials, 'same-origin');
  assert.equal(request?.init?.body, JSON.stringify({rewardIds: ['100']}));
  assert.deepEqual(renderedItems.map((item) => item.isNew), [true, false]);
});

test('mark-seen failure leaves rendered badge state intact and remains non-blocking to callers', async () => {
  const originalFetch = globalThis.fetch;
  const renderedItems = [{hourRewardId: '100', isNew: true}];
  globalThis.fetch = (async () => new Response(null, {status: 503})) as typeof fetch;

  try {
    await assert.rejects(markRewardsSeen(['100']), (error: unknown) => (
      error instanceof ApiError && error.status === 503
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(renderedItems[0].isNew, true);
});

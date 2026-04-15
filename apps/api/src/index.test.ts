// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { createApp } from './index';

describe('createApp', () => {
  it('returns an object with name api', () => {
    const app = createApp();
    expect(app.name).toBe('api');
  });
});

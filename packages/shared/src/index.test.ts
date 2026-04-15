// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { VERSION } from './index';

describe('VERSION', () => {
  it('equals 0.0.1', () => {
    expect(VERSION).toBe('0.0.1');
  });
});

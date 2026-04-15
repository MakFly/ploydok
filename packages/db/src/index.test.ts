// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { schemas } from './index';

describe('schemas', () => {
  it('is an empty const object', () => {
    expect(schemas).toEqual({});
  });
});

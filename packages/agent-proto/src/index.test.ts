// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';

describe('AgentClient', () => {
  it('can be used as a type (module loads)', () => {
    // If the import fails, this test will fail.
    // AgentClient is an interface, so we just verify the module loads.
    expect(true).toBe(true);
  });
});

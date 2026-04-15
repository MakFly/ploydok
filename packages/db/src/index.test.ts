// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { users, sessions, projects, apps, secrets, backup_codes, passkeys, audit_log } from './schema';

describe('schema exports', () => {
  it('exports all 8 tables', () => {
    expect(users).toBeDefined();
    expect(sessions).toBeDefined();
    expect(projects).toBeDefined();
    expect(apps).toBeDefined();
    expect(secrets).toBeDefined();
    expect(backup_codes).toBeDefined();
    expect(passkeys).toBeDefined();
    expect(audit_log).toBeDefined();
  });
});

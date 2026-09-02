import { describe, expect, it } from 'vitest';
import {
  ROLES, canDelete, canEditLeads, canInvite, canManageUsers, canViewLeads, isRole,
} from './roles';

describe('isRole', () => {
  it('accepts the two real roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('manager')).toBe(true);
  });

  it('rejects anything else, including near-misses and non-strings', () => {
    // This guards the boundary where a role arrives from a form or a database
    // column, so "administrator" must not slip through as "admin".
    for (const v of ['administrator', 'Admin', 'owner', 'superuser', '', null, undefined, 1, {}]) {
      expect(isRole(v), String(v)).toBe(false);
    }
  });
});

describe('admin capabilities', () => {
  it('may invite and manage users', () => {
    expect(canInvite('admin')).toBe(true);
    expect(canManageUsers('admin')).toBe(true);
  });

  it('may work the pipeline like anyone else', () => {
    expect(canViewLeads('admin')).toBe(true);
    expect(canEditLeads('admin')).toBe(true);
  });
});

describe('manager capabilities', () => {
  it('may read and update leads', () => {
    expect(canViewLeads('manager')).toBe(true);
    expect(canEditLeads('manager')).toBe(true);
  });

  it('may NOT invite or manage users', () => {
    // The whole point of the role. If this ever flips, a manager can create
    // accounts and the single-admin rule stops meaning anything.
    expect(canInvite('manager')).toBe(false);
    expect(canManageUsers('manager')).toBe(false);
  });
});

describe('canDelete', () => {
  it('is false for every role, including admin', () => {
    // Access is revoked by disabling, never by deleting — a deleted row loses
    // the record of who invited whom.
    for (const role of ROLES) expect(canDelete(role), role).toBe(false);
  });
});

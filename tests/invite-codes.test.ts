import assert from "node:assert/strict";
import test from "node:test";

import { createInviteCode, hashInviteCode, normalizeInviteCode } from "../src/server/inviteCodes";

test("invite codes are generated in a readable 12-character format", () => {
  const code = createInviteCode();
  assert.match(code, /^(?:[A-F0-9]{4}-){2}[A-F0-9]{4}$/);
  assert.equal(normalizeInviteCode(code).length, 12);
});

test("invite code hashing ignores separators and letter case", () => {
  assert.equal(
    hashInviteCode("ABCD-EF12-3456"),
    hashInviteCode("abcd ef12 3456"),
  );
});

test("generated invite codes do not repeat in a practical sample", () => {
  const codes = new Set(Array.from({ length: 1_000 }, () => createInviteCode()));
  assert.equal(codes.size, 1_000);
});

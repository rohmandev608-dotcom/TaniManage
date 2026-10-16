const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, newToken, hashToken, safeEqual } = require('./Security');

test('password hashes verify without storing the original password', () => {
  const password = 'panen-aman-2026!';
  const encoded = hashPassword(password);

  assert.notEqual(encoded, password);
  assert.match(encoded, /^\$scrypt\$/);
  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword('password-yang-salah', encoded), false);
});

test('session tokens are random, hashed, and compared safely', () => {
  const token = newToken();

  assert.equal(token.length, 43);
  assert.notEqual(hashToken(token), token);
  assert.equal(safeEqual('same-token', 'same-token'), true);
  assert.equal(safeEqual('same-token', 'other-token'), false);
});

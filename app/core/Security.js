const crypto = require('node:crypto');

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `$scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, encodedHash) {
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[1] !== 'scrypt') {
    return false;
  }

  const [, , cost, blockSize, parallelization, saltHex, hashHex] = parts;
  if (![cost, blockSize, parallelization].every((part) => /^\d+$/.test(part))
    || Number(cost) !== SCRYPT_OPTIONS.N
    || Number(blockSize) !== SCRYPT_OPTIONS.r
    || Number(parallelization) !== SCRYPT_OPTIONS.p
    || !/^[a-f\d]{32}$/i.test(saltHex)
    || !/^[a-f\d]{128}$/i.test(hashHex)) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
    maxmem: SCRYPT_OPTIONS.maxmem
  });
  return crypto.timingSafeEqual(actual, expected);
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = { hashPassword, verifyPassword, newToken, hashToken, safeEqual };

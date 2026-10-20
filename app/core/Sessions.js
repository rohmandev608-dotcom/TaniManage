const { hashToken, newToken } = require('./Security');

const SESSION_COOKIE = 'fmis_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function readCookie(request) {
  const header = request.headers.cookie || '';
  const cookie = header.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

class Sessions {
  constructor(database) {
    this.database = database;
  }

  async load(request) {
    const token = readCookie(request);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      request.session = null;
      return;
    }

    const session = await this.database.findSession(hashToken(token));
    if (!session || session.expires_at <= Date.now()) {
      await this.database.deleteSession(hashToken(token));
      request.session = null;
      return;
    }

    request.session = {
      userId: session.user_id,
      csrfToken: session.csrf_token,
      tokenHash: hashToken(token)
    };
  }

  async ensure(request, response, userId = null) {
    if (request.session) {
      return request.session;
    }

    const token = newToken();
    const session = {
      userId,
      csrfToken: newToken(),
      tokenHash: hashToken(token)
    };
    await this.database.createSession(session.tokenHash, userId, session.csrfToken,
      Date.now() + SESSION_TTL_SECONDS * 1000);
    this.setCookie(response, token);
    request.session = session;
    return session;
  }

  async regenerate(request, response, userId) {
    if (request.session) {
      await this.database.deleteSession(request.session.tokenHash);
    }
    request.session = null;
    return await this.ensure(request, response, userId);
  }

  async destroy(request, response) {
    if (request.session) {
      await this.database.deleteSession(request.session.tokenHash);
    }
    request.session = null;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  }

  setCookie(response, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  }
}

module.exports = Sessions;

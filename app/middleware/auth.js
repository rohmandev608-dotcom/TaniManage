const { safeEqual } = require('../core/Security');

function loadSession(sessions, database) {
  return async (request, response, next) => {
    await sessions.load(request);
    request.user = request.session && request.session.userId !== null
      ? await database.getPublicUserById(request.session.userId)
      : null;

    if (request.session && request.session.userId !== null && !request.user) {
      await sessions.destroy(request, response);
    }

    return await next();
  };
}

function requireAuth(request, response, next) {
  if (!request.user) {
    response.writeHead(303, { Location: '/login' });
    response.end();
    return;
  }
  return next();
}

function requireRoles(...roles) {
  return (request, response, next) => {
    if (!request.user) {
      response.writeHead(303, { Location: '/login' });
      response.end();
      return;
    }
    if (!roles.includes(request.user.role)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Anda tidak memiliki hak untuk mengakses halaman ini.');
      return;
    }
    return next();
  };
}

function requireCsrf(request, response, next) {
  const submitted = request.body && request.body._csrf;
  if (!request.session || !submitted || !safeEqual(submitted, request.session.csrfToken)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Token keamanan tidak valid atau sesi telah berakhir.');
    return;
  }
  return next();
}

function requireOwner(parameter = 'userId') {
  return (request, response, next) => {
    if (!request.user) {
      response.writeHead(303, { Location: '/login' });
      response.end();
      return;
    }
    if (String(request.user.id) !== String(request.params[parameter])) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Data tidak ditemukan.');
      return;
    }
    return next();
  };
}

module.exports = { loadSession, requireAuth, requireRoles, requireCsrf, requireOwner };

const Security = require('../core/Security');
const View = require('../core/View');

const DUMMY_PASSWORD_HASH = Security.hashPassword('not-a-real-user-password');
const VALID_ROLES = new Set(['farmer', 'worker']);

function renderError(response, template, error, values = {}) {
  View.render(response, template, { ...values, error });
}

function createAuthController(database, sessions) {
  function registerPage(request, response) {
    if (request.user) {
      View.redirect(response, '/dashboard');
      return;
    }
    const session = sessions.ensure(request, response);
    View.render(response, 'auth/register.html', { csrfToken: session.csrfToken });
  }

  function register(request, response) {
    const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
    const email = typeof request.body.email === 'string'
      ? request.body.email.trim().toLowerCase()
      : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    const role = typeof request.body.role === 'string' ? request.body.role : 'farmer';

    if (name.length < 2 || name.length > 80) {
      renderError(response, 'auth/register.html', 'Nama harus terdiri dari 2–80 karakter.', {
        csrfToken: request.session.csrfToken,
        name,
        email
      });
      return;
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      renderError(response, 'auth/register.html', 'Format email tidak valid.', {
        csrfToken: request.session.csrfToken,
        name,
        email
      });
      return;
    }
    if (password.length < 12 || password.length > 128) {
      renderError(response, 'auth/register.html', 'Password harus terdiri dari 12–128 karakter.', {
        csrfToken: request.session.csrfToken,
        name,
        email
      });
      return;
    }
    if (!VALID_ROLES.has(role)) {
      renderError(response, 'auth/register.html', 'Peran pendaftaran tidak valid.', {
        csrfToken: request.session.csrfToken,
        name,
        email
      });
      return;
    }

    try {
      const user = database.createUser({
        name,
        email,
        passwordHash: Security.hashPassword(password),
        role
      });
      sessions.regenerate(request, response, user.id);
      View.redirect(response, '/dashboard');
    } catch (error) {
      if (error.code !== 'ERR_SQLITE_ERROR' || !String(error.message).includes('UNIQUE constraint failed: users.email')) {
        throw error;
      }
      renderError(response, 'auth/register.html', 'Email tersebut sudah terdaftar.', {
        csrfToken: request.session.csrfToken,
        name,
        email
      });
    }
  }

  function loginPage(request, response) {
    if (request.user) {
      View.redirect(response, '/dashboard');
      return;
    }
    const session = sessions.ensure(request, response);
    View.render(response, 'auth/login.html', { csrfToken: session.csrfToken });
  }

  function login(request, response) {
    const email = typeof request.body.email === 'string'
      ? request.body.email.trim().toLowerCase()
      : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    const user = email.length <= 254 ? database.findUserByEmail(email) : null;
    const passwordValid = Security.verifyPassword(
      password.slice(0, 128),
      user ? user.password_hash : DUMMY_PASSWORD_HASH
    );

    if (!user || !passwordValid) {
      renderError(response, 'auth/login.html', 'Email atau password salah.', {
        csrfToken: request.session.csrfToken,
        email
      });
      return;
    }

    sessions.regenerate(request, response, user.id);
    View.redirect(response, '/dashboard');
  }

  function logout(request, response) {
    sessions.destroy(request, response);
    View.redirect(response, '/');
  }

  return { registerPage, register, loginPage, login, logout };
}

module.exports = { createAuthController };

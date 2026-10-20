const View = require('../core/View');

const ALLOWED_ROLES = new Set(['farmer', 'worker', 'admin']);

function createAdminController(database) {
  async function listUsers(request, response) {
    View.sendJson(response, 200, { users: await database.listPublicUsers() });
  }

  async function changeRole(request, response) {
    const userId = Number(request.body.userId);
    const role = request.body.role;
    if (!Number.isSafeInteger(userId) || userId < 1 || !ALLOWED_ROLES.has(role)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('ID pengguna atau peran tidak valid.');
      return;
    }

    const target = await database.getPublicUserById(userId);
    if (!target) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Pengguna tidak ditemukan.');
      return;
    }
    if (target.role === 'admin' && role !== 'admin' && await database.countUsersByRole('admin') <= 1) {
      response.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Peran admin terakhir tidak dapat dihapus.');
      return;
    }

    await database.setUserRole(userId, role);
    View.redirect(response, '/admin');
  }

  return { listUsers, changeRole };
}

module.exports = { createAdminController };

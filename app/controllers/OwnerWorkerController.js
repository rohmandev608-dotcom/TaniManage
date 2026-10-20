const crypto = require('node:crypto');
const View = require('../core/View');

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function createOwnerWorkerController(database) {
  function page(request, response) {
    View.render(response, 'dashboard/workers.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken
    });
  }

  async function list(request, response) {
    const inviteCode = await database.ensureOwnerInvite(
      request.user.id,
      crypto.randomBytes(32).toString('base64url')
    );
    const joinUrl = `/worker/join?invite=${encodeURIComponent(inviteCode)}`;
    View.sendJson(response, 200, {
      ...(await database.listOwnerWorkers(request.user.id)),
      fields: await database.listOwnerFieldsForWorkerAssignment(request.user.id),
      invite: { joinUrl }
    });
  }

  async function assign(request, response) {
    const workerId = parsePositiveInteger(request.body.workerId);
    const fieldId = parsePositiveInteger(request.body.fieldId);
    const cropCycleId = parsePositiveInteger(request.body.cropCycleId);
    if (!workerId || !fieldId || !cropCycleId) {
      View.sendJson(response, 400, { error: 'Pilih buruh, lahan, dan musim tanam yang valid.' });
      return;
    }

    try {
      const created = await database.assignWorkerToCropCycle(
        request.user.id,
        workerId,
        fieldId,
        cropCycleId
      );
      View.sendJson(response, created ? 201 : 200, {
        message: created ? 'Penugasan berhasil dibuat.' : 'Buruh sudah ditugaskan pada musim tanam ini.'
      });
    } catch (error) {
      if (error.code === 'WORKER_NOT_CONNECTED' || error.code === 'ASSIGNMENT_CYCLE_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      throw error;
    }
  }

  async function remove(request, response) {
    const workerId = parsePositiveInteger(request.params.workerId);
    if (!workerId) {
      View.sendJson(response, 400, { error: 'ID buruh tidak valid.' });
      return;
    }
    const removed = await database.removeWorkerFromOwner(request.user.id, workerId);
    if (!removed) {
      View.sendJson(response, 404, { error: 'Buruh tidak ditemukan dalam tim owner ini.' });
      return;
    }
    View.sendJson(response, 200, { message: 'Buruh telah dikeluarkan dari tim.' });
  }

  return { page, list, assign, remove };
}

module.exports = { createOwnerWorkerController };

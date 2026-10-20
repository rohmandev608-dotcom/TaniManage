const View = require('../core/View');
const { parseQuantity, isValidDate } = require('./InventoryController');
const { ACTIVITY_TYPES } = require('./FieldActivityController');

function createWorkerController(database) {
  async function listAssignedResources(request, response) {
    View.sendJson(response, 200, {
      assignments: await database.listWorkerAssignments(request.user.id),
      inventoryItems: await database.listWorkerInventoryOptions(request.user.id),
      activities: await database.listWorkerFieldActivities(request.user.id)
    });
  }

  async function joinOwner(request, response) {
    const inviteCode = typeof request.body.inviteCode === 'string'
      ? request.body.inviteCode.trim()
      : '';
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(inviteCode)) {
      View.sendJson(response, 400, { error: 'Kode undangan tidak valid.' });
      return;
    }

    try {
      View.sendJson(response, 200, {
        membership: await database.joinWorkerWithInvite(request.user.id, inviteCode)
      });
    } catch (error) {
      if (error.code === 'INVALID_WORKER_INVITE') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      throw error;
    }
  }

  async function createFieldActivity(request, response) {
    const assignmentId = Number(request.body.assignmentId);
    const activityType = typeof request.body.activityType === 'string'
      ? request.body.activityType
      : '';
    const date = typeof request.body.date === 'string' ? request.body.date : '';
    const description = typeof request.body.description === 'string'
      ? request.body.description.trim()
      : '';
    const itemIdValue = typeof request.body.itemId === 'string'
      ? request.body.itemId.trim()
      : '';
    const itemId = itemIdValue ? Number(itemIdValue) : null;
    const quantityValue = typeof request.body.quantity === 'string'
      ? request.body.quantity.trim()
      : '';
    const quantityMilli = itemId === null
      ? 0
      : parseQuantity(quantityValue);

    if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) {
      View.sendJson(response, 400, { error: 'Pilih penugasan lahan yang valid.' });
      return;
    }
    if (!ACTIVITY_TYPES.has(activityType)) {
      View.sendJson(response, 400, { error: 'Jenis aktivitas tidak valid.' });
      return;
    }
    if (!isValidDate(date)) {
      View.sendJson(response, 400, { error: 'Tanggal aktivitas tidak valid.' });
      return;
    }
    if (description.length > 1000) {
      View.sendJson(response, 400, { error: 'Catatan maksimal 1.000 karakter.' });
      return;
    }
    if (itemIdValue && (!Number.isSafeInteger(itemId) || itemId < 1)) {
      View.sendJson(response, 400, { error: 'Bahan inventaris tidak valid.' });
      return;
    }
    if ((itemId !== null && quantityMilli === null)
      || (itemId === null && quantityValue !== '' && quantityValue !== '0')) {
      View.sendJson(response, 400, { error: 'Jumlah pemakaian harus positif dan maksimal 3 angka desimal.' });
      return;
    }

    try {
      const activity = await database.createFieldActivityWithInventory(
        null,
        {
          assignmentId,
          activityType,
          date,
          description,
          itemId,
          quantityMilli: quantityMilli || 0,
          quantityLabel: quantityValue
        },
        request.user.id
      );
      if (activity.consumedItem) {
        activity.consumedItem = {
          name: activity.consumedItem.name,
          unit: activity.consumedItem.unit,
          quantityMilli: activity.consumedItem.quantityMilli
        };
      }
      View.sendJson(response, 201, { activity });
    } catch (error) {
      if (error.code === 'WORKER_ASSIGNMENT_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'NO_ACTIVE_CROP_CYCLE') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      if (error.code === 'INVENTORY_ITEM_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'INVENTORY_COST_LIMIT' || error.code === 'INVALID_USAGE') {
        View.sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  }

  async function listActivities(request, response) {
    View.sendJson(response, 200, {
      activities: await database.listWorkerActivitiesForUser(request.user.id)
    });
  }

  async function createActivity(request, response) {
    const activity = typeof request.body.activity === 'string'
      ? request.body.activity.trim()
      : '';
    const activityDate = request.body.activityDate;

    if (activity.length < 1 || activity.length > 1000) {
      View.sendJson(response, 400, { error: 'Catatan aktivitas wajib diisi (maksimal 1000 karakter).' });
      return;
    }
    const parsedDate = typeof activityDate === 'string'
      ? new Date(`${activityDate}T00:00:00.000Z`)
      : null;
    if (typeof activityDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(activityDate)
      || Number.isNaN(parsedDate.valueOf())
      || parsedDate.toISOString().slice(0, 10) !== activityDate) {
      View.sendJson(response, 400, { error: 'Tanggal aktivitas tidak valid.' });
      return;
    }

    const savedActivity = await database.createWorkerActivity(
      request.user.id,
      activityDate,
      activity
    );
    View.sendJson(response, 201, { activity: savedActivity });
  }

  return {
    listAssignedResources,
    joinOwner,
    createFieldActivity,
    listActivities,
    createActivity
  };
}

module.exports = { createWorkerController };

const View = require('../core/View');
const { parseQuantity, isValidDate } = require('./InventoryController');

const ACTIVITY_TYPES = new Set([
  'Pemupukan',
  'Penyemprotan',
  'Penyiraman',
  'Penyiangan',
  'Pengolahan Tanah',
  'Penanaman',
  'Panen',
  'Lainnya'
]);

function createFieldActivityController(database) {
  function page(request, response) {
    View.render(response, 'dashboard/aktivitas-lahan.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken,
      pageTitle: 'Aktivitas Lahan',
      activityNavClass: 'bg-emerald-600 text-white shadow-md',
      dashboardNavClass: '',
      landNavClass: '',
      financeNavClass: '',
      inventoryNavClass: '',
      cropCycleNavClass: ''
    });
  }

  function list(request, response) {
    View.sendJson(response, 200, {
      activities: database.listFieldActivitiesForOwner(request.user.id),
      fields: database.listLandsWithActiveCropCycleForOwner(request.user.id)
    });
  }

  function create(request, response) {
    const fieldId = Number(request.body.fieldId);
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
    const quantityMilli = itemId === null ? 0 : parseQuantity(quantityValue);

    if (!Number.isSafeInteger(fieldId) || fieldId < 1) {
      View.sendJson(response, 400, { error: 'Pilih lahan yang valid.' });
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
    if (itemId !== null && quantityMilli === null) {
      View.sendJson(response, 400, { error: 'Jumlah pemakaian harus positif dan maksimal 3 angka desimal.' });
      return;
    }

    try {
      const activity = database.createFieldActivityWithInventory(request.user.id, {
        fieldId,
        activityType,
        date,
        description,
        itemId,
        quantityMilli,
        quantityLabel: quantityValue
      });
      View.sendJson(response, 201, { activity });
    } catch (error) {
      if (error.code === 'LAND_NOT_FOUND' || error.code === 'INVENTORY_ITEM_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'NO_ACTIVE_CROP_CYCLE') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      if (error.code === 'INSUFFICIENT_STOCK') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      if (error.code === 'INVENTORY_COST_LIMIT') {
        View.sendJson(response, 400, { error: error.message });
        return;
      }
      if (error.code === 'INVALID_USAGE') {
        View.sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  }

  return { page, list, create };
}

module.exports = { createFieldActivityController, ACTIVITY_TYPES };

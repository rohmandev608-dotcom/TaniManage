const View = require('../core/View');

const CATEGORIES = {
  income: new Set(['Penjualan Panen', 'Pendapatan Lain']),
  expense: new Set([
    'Beli Pupuk',
    'Bibit',
    'Upah Buruh',
    'Pestisida',
    'Irigasi',
    'Sewa Alat',
    'Transportasi',
    'Biaya Lain'
  ])
};

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function createFinanceController(database) {
  function page(request, response) {
    View.render(response, 'dashboard/keuangan.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken,
      pageTitle: 'Keuangan',
      financeNavClass: 'bg-emerald-600 text-white shadow-md',
      dashboardNavClass: '',
      landNavClass: '',
      activityNavClass: '',
      inventoryNavClass: '',
      cropCycleNavClass: ''
    });
  }

  function list(request, response) {
    const searchParams = new URL(request.url, 'http://localhost').searchParams;
    const rawFieldId = searchParams.get('fieldId');
    const rawCropCycleId = searchParams.get('cropCycleId');
    let fieldId = null;
    let cropCycleId = null;

    if (rawFieldId && rawFieldId !== 'unassigned') {
      fieldId = Number(rawFieldId);
      if (!Number.isSafeInteger(fieldId) || fieldId < 1) {
        View.sendJson(response, 400, { error: 'Filter lahan tidak valid.' });
        return;
      }
      if (!database.getLandForOwner(request.user.id, fieldId)) {
        View.sendJson(response, 404, { error: 'Lahan tidak ditemukan.' });
        return;
      }
    } else if (rawFieldId === 'unassigned') {
      fieldId = 'unassigned';
    }

    if (rawCropCycleId) {
      cropCycleId = Number(rawCropCycleId);
      if (!Number.isSafeInteger(cropCycleId) || cropCycleId < 1) {
        View.sendJson(response, 400, { error: 'Filter musim tanam tidak valid.' });
        return;
      }
      const cycle = database.getCropCycleForOwner(request.user.id, cropCycleId);
      if (!cycle) {
        View.sendJson(response, 404, { error: 'Musim tanam tidak ditemukan.' });
        return;
      }
      if (fieldId === 'unassigned' || (fieldId !== null && fieldId !== cycle.field_id)) {
        View.sendJson(response, 400, { error: 'Filter lahan tidak sesuai dengan musim tanam.' });
        return;
      }
    }

    View.sendJson(response, 200, {
      fields: database.listLandsWithActiveCropCycleForOwner(request.user.id),
      cropCycles: database.listCropCyclesForOwner(request.user.id),
      summary: database.getFinancialSummaryForOwner(request.user.id, fieldId, cropCycleId),
      transactions: database.listFinancialTransactionsForOwner(request.user.id, fieldId, cropCycleId)
    });
  }

  function create(request, response) {
    const type = request.body.type;
    const category = typeof request.body.category === 'string' ? request.body.category : '';
    const date = typeof request.body.date === 'string' ? request.body.date : '';
    const rawAmount = typeof request.body.amountRupiah === 'string'
      ? request.body.amountRupiah.trim()
      : '';
    const description = typeof request.body.description === 'string'
      ? request.body.description.trim()
      : '';
    const rawFieldId = typeof request.body.fieldId === 'string'
      ? request.body.fieldId.trim()
      : '';

    if (!Object.hasOwn(CATEGORIES, type) || !CATEGORIES[type].has(category)) {
      View.sendJson(response, 400, { error: 'Jenis atau kategori transaksi tidak valid.' });
      return;
    }
    if (!isValidDate(date)) {
      View.sendJson(response, 400, { error: 'Tanggal transaksi tidak valid.' });
      return;
    }
    if (!/^[1-9]\d{0,14}$/.test(rawAmount)) {
      View.sendJson(response, 400, { error: 'Nominal wajib berupa bilangan Rupiah positif.' });
      return;
    }
    const amountRupiah = Number(rawAmount);
    if (!Number.isSafeInteger(amountRupiah)) {
      View.sendJson(response, 400, { error: 'Nominal terlalu besar.' });
      return;
    }
    if (description.length > 500) {
      View.sendJson(response, 400, { error: 'Catatan maksimal 500 karakter.' });
      return;
    }

    let fieldId = null;
    if (rawFieldId) {
      fieldId = Number(rawFieldId);
      if (!Number.isSafeInteger(fieldId) || fieldId < 1) {
        View.sendJson(response, 400, { error: 'Lahan tidak valid.' });
        return;
      }
      if (!database.getLandForOwner(request.user.id, fieldId)) {
        View.sendJson(response, 404, { error: 'Lahan tidak ditemukan.' });
        return;
      }
    }

    try {
      const transaction = database.createFinancialTransaction(request.user.id, {
        fieldId,
        type,
        category,
        date,
        amountRupiah,
        description
      });
      View.sendJson(response, 201, { transaction });
    } catch (error) {
      if (error.code === 'LAND_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'NO_ACTIVE_CROP_CYCLE') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      throw error;
    }
  }

  return { page, list, create };
}

module.exports = { createFinanceController, isValidDate, CATEGORIES };

const View = require('../core/View');

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function createCropCycleController(database) {
  function page(request, response) {
    View.render(response, 'dashboard/musim-tanam.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken,
      pageTitle: 'Musim Tanam',
      cropCycleNavClass: 'bg-emerald-600 text-white shadow-md',
      dashboardNavClass: '',
      landNavClass: '',
      financeNavClass: '',
      activityNavClass: '',
      inventoryNavClass: ''
    });
  }

  function list(request, response) {
    View.sendJson(response, 200, {
      cycles: database.listCropCyclesForOwner(request.user.id),
      fields: database.listLandsWithActiveCropCycleForOwner(request.user.id)
    });
  }

  function create(request, response) {
    const fieldId = Number(request.body.fieldId);
    const commodityName = typeof request.body.commodityName === 'string'
      ? request.body.commodityName.trim()
      : '';
    const variety = typeof request.body.variety === 'string' ? request.body.variety.trim() : '';
    const startDate = typeof request.body.startDate === 'string' ? request.body.startDate : '';
    const expectedHarvestDate = typeof request.body.expectedHarvestDate === 'string'
      ? request.body.expectedHarvestDate
      : '';

    if (!Number.isSafeInteger(fieldId) || fieldId < 1) {
      View.sendJson(response, 400, { error: 'Pilih lahan yang valid.' });
      return;
    }
    if (commodityName.length < 2 || commodityName.length > 100) {
      View.sendJson(response, 400, { error: 'Nama komoditas harus terdiri dari 2–100 karakter.' });
      return;
    }
    if (variety.length > 100) {
      View.sendJson(response, 400, { error: 'Varietas maksimal 100 karakter.' });
      return;
    }
    if (!isValidDate(startDate)) {
      View.sendJson(response, 400, { error: 'Tanggal mulai tidak valid.' });
      return;
    }
    if (expectedHarvestDate && (!isValidDate(expectedHarvestDate) || expectedHarvestDate <= startDate)) {
      View.sendJson(response, 400, { error: 'Estimasi panen harus berupa tanggal valid setelah tanggal mulai.' });
      return;
    }

    try {
      const cycle = database.createCropCycle(request.user.id, {
        fieldId,
        commodityName,
        variety,
        startDate,
        expectedHarvestDate
      });
      View.sendJson(response, 201, { cycle });
    } catch (error) {
      if (error.code === 'LAND_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'ACTIVE_CROP_CYCLE_EXISTS') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      throw error;
    }
  }

  function report(request, response) {
    const cycleId = Number(request.params.id);
    const result = Number.isSafeInteger(cycleId) && cycleId > 0
      ? database.getCropCycleReportForOwner(request.user.id, cycleId)
      : null;
    if (!result) {
      View.sendJson(response, 404, { error: 'Musim tanam tidak ditemukan.' });
      return;
    }
    View.sendJson(response, 200, result);
  }

  function complete(request, response) {
    const cycleId = Number(request.params.id);
    if (!Number.isSafeInteger(cycleId) || cycleId < 1) {
      View.sendJson(response, 404, { error: 'Musim tanam tidak ditemukan.' });
      return;
    }

    try {
      View.sendJson(response, 200, {
        cycle: database.completeCropCycle(request.user.id, cycleId)
      });
    } catch (error) {
      if (error.code === 'CROP_CYCLE_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'CROP_CYCLE_ALREADY_COMPLETED') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      if (error.code === 'CROP_CYCLE_NOT_STARTED') {
        View.sendJson(response, 409, { error: error.message });
        return;
      }
      throw error;
    }
  }

  return { page, list, create, report, complete };
}

module.exports = { createCropCycleController, isValidDate };

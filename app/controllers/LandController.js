const View = require('../core/View');

const SOIL_TYPES = new Set(['', 'alluvial', 'volcanic', 'humus', 'latosol']);
const SOIL_SELECTIONS = {
  alluvial: 'alluvialSelected',
  volcanic: 'volcanicSelected',
  humus: 'humusSelected',
  latosol: 'latosolSelected'
};

function getFormValues(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    areaHectares: typeof body.areaHectares === 'string' ? body.areaHectares.trim() : '',
    soilType: typeof body.soilType === 'string' ? body.soilType : '',
    commodity: typeof body.commodity === 'string' ? body.commodity.trim() : '',
    coordinates: typeof body.coordinates === 'string' ? body.coordinates.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : ''
  };
}

function validateLand(values) {
  if (values.name.length < 2 || values.name.length > 100) {
    return 'Nama lahan harus terdiri dari 2–100 karakter.';
  }

  const area = Number(values.areaHectares);
  if (!values.areaHectares || !Number.isFinite(area) || area <= 0 || area > 100000) {
    return 'Luas lahan harus lebih dari 0 dan tidak melebihi 100.000 hektar.';
  }

  if (!SOIL_TYPES.has(values.soilType)) {
    return 'Jenis tanah tidak valid.';
  }
  if (values.commodity.length > 100) {
    return 'Rencana komoditas maksimal 100 karakter.';
  }
  if (values.coordinates.length > 100) {
    return 'Koordinat maksimal 100 karakter.';
  }
  if (values.coordinates) {
    const match = values.coordinates.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!match
      || Math.abs(Number(match[1])) > 90
      || Math.abs(Number(match[2])) > 180) {
      return 'Koordinat harus berupa lintang, bujur yang valid (contoh: -8.2192, 114.3691).';
    }
  }
  if (values.notes.length > 2000) {
    return 'Catatan maksimal 2.000 karakter.';
  }

  return null;
}

function viewData(request, values = {}, error = '', editing = false) {
  const selections = Object.fromEntries(
    Object.values(SOIL_SELECTIONS).map((key) => [key, ''])
  );
  if (SOIL_SELECTIONS[values.soilType]) {
    selections[SOIL_SELECTIONS[values.soilType]] = 'selected';
  }

  return {
    ...values,
    ...selections,
    error,
    name: request.user.name,
    landName: values.name || '',
    notes: values.notes || '',
    csrfToken: request.session.csrfToken,
    pageTitle: editing ? 'Ubah Data Lahan' : 'Tambah Lahan Baru',
    formHeading: editing ? 'Perbarui Informasi Petak Lahan' : 'Informasi Petak Lahan',
    submitLabel: editing ? 'Simpan Perubahan' : 'Simpan Lahan',
    dashboardNavClass: 'flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white transition',
    landNavClass: 'flex items-center space-x-3 px-4 py-3 rounded-xl bg-emerald-600 text-white shadow-md',
    financeNavClass: '',
    activityNavClass: '',
    inventoryNavClass: '',
    cropCycleNavClass: '',
    formAction: editing
      ? `/farmer/lands/${request.params.id}/update`
      : '/farmer/lands'
  };
}

function createLandController(database) {
  function listPage(request, response) {
    View.render(response, 'dashboard/daftar-lahan.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken,
      pageTitle: 'Daftar Lahan',
      dashboardNavClass: 'flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white transition',
      landNavClass: 'flex items-center space-x-3 px-4 py-3 rounded-xl bg-emerald-600 text-white shadow-md',
      financeNavClass: '',
      activityNavClass: '',
      inventoryNavClass: '',
      cropCycleNavClass: ''
    });
  }

  function list(request, response) {
    View.sendJson(response, 200, {
      lands: database.listLandsForOwner(request.user.id)
    });
  }

  function show(request, response) {
    const landId = Number(request.params.id);
    const land = Number.isSafeInteger(landId) && landId > 0
      ? database.getLandForOwner(request.user.id, landId)
      : null;

    if (!land) {
      View.sendJson(response, 404, { error: 'Lahan tidak ditemukan.' });
      return;
    }

    View.sendJson(response, 200, { land });
  }

  function newPage(request, response) {
    View.render(response, 'dashboard/tambah-lahan.html', viewData(request));
  }

  function create(request, response) {
    const values = getFormValues(request.body);
    const error = validateLand(values);
    if (error) {
      View.render(response, 'dashboard/tambah-lahan.html', viewData(request, values, error));
      return;
    }

    database.createLand(request.user.id, {
      ...values,
      areaHectares: Number(values.areaHectares)
    });
    View.redirect(response, '/farmer/lands');
  }

  function editPage(request, response) {
    const landId = Number(request.params.id);
    if (!Number.isSafeInteger(landId) || landId < 1) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Lahan tidak ditemukan.');
      return;
    }

    const land = database.getLandForOwner(request.user.id, landId);
    if (!land) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Lahan tidak ditemukan.');
      return;
    }

    View.render(response, 'dashboard/tambah-lahan.html', viewData(request, {
      ...land,
      areaHectares: String(land.area_hectares)
    }, '', true));
  }

  function update(request, response) {
    const landId = Number(request.params.id);
    if (!Number.isSafeInteger(landId) || landId < 1) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Lahan tidak ditemukan.');
      return;
    }

    const existing = database.getLandForOwner(request.user.id, landId);
    if (!existing) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Lahan tidak ditemukan.');
      return;
    }

    const values = getFormValues(request.body);
    const error = validateLand(values);
    if (error) {
      request.params.id = String(landId);
      View.render(response, 'dashboard/tambah-lahan.html', viewData(request, values, error, true));
      return;
    }

    database.updateLandForOwner(request.user.id, landId, {
      ...values,
      areaHectares: Number(values.areaHectares)
    });
    View.redirect(response, '/farmer/lands');
  }

  function remove(request, response) {
    const landId = Number(request.params.id);
    if (!Number.isSafeInteger(landId) || landId < 1
      || !database.getLandForOwner(request.user.id, landId)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Lahan tidak ditemukan.');
      return;
    }
    try {
      database.deleteLandForOwner(request.user.id, landId);
    } catch (error) {
      if (error.code === 'LAND_HAS_CROP_CYCLES') {
        response.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error.message);
        return;
      }
      throw error;
    }

    View.redirect(response, '/farmer/lands');
  }

  return { listPage, list, show, newPage, create, editPage, update, remove };
}

module.exports = { createLandController, validateLand };

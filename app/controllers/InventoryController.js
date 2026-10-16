const View = require('../core/View');

function parseQuantity(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) {
    return null;
  }
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  return Math.round(quantity * 1000);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function createInventoryController(database) {
  function page(request, response) {
    View.render(response, 'dashboard/inventaris.html', {
      name: request.user.name,
      csrfToken: request.session.csrfToken,
      pageTitle: 'Inventaris',
      inventoryNavClass: 'bg-emerald-600 text-white shadow-md',
      dashboardNavClass: '',
      landNavClass: '',
      activityNavClass: '',
      financeNavClass: '',
      cropCycleNavClass: ''
    });
  }

  function list(request, response) {
    View.sendJson(response, 200, {
      items: database.listInventoryItemsForOwner(request.user.id).map((item) => ({
        ...item,
        quantity: item.quantity_milli / 1000,
        averageUnitCostRupiah: item.average_unit_cost_micros / 1_000_000
      }))
    });
  }

  function purchase(request, response) {
    const itemIdValue = typeof request.body.itemId === 'string'
      ? request.body.itemId.trim()
      : '';
    const itemName = typeof request.body.itemName === 'string' ? request.body.itemName.trim() : '';
    const unit = typeof request.body.unit === 'string' ? request.body.unit.trim() : '';
    const quantityValue = typeof request.body.quantity === 'string'
      ? request.body.quantity.trim()
      : '';
    const amountValue = typeof request.body.amountRupiah === 'string'
      ? request.body.amountRupiah.trim()
      : '';
    const date = typeof request.body.date === 'string' ? request.body.date : '';
    const quantityMilli = parseQuantity(quantityValue);
    const amountRupiah = Number(amountValue);
    const itemId = itemIdValue ? Number(itemIdValue) : null;

    if (itemIdValue && (!Number.isSafeInteger(itemId) || itemId < 1)) {
      View.sendJson(response, 400, { error: 'Bahan inventaris tidak valid.' });
      return;
    }
    if (itemId === null && (itemName.length < 2 || itemName.length > 100
      || unit.length < 1 || unit.length > 20)) {
      View.sendJson(response, 400, { error: 'Nama bahan (2–100 karakter) dan satuan (1–20 karakter) wajib diisi untuk bahan baru.' });
      return;
    }
    if (quantityMilli === null) {
      View.sendJson(response, 400, { error: 'Jumlah pembelian harus positif dan maksimal 3 angka desimal.' });
      return;
    }
    if (!/^[1-9]\d{0,14}$/.test(amountValue) || !Number.isSafeInteger(amountRupiah)) {
      View.sendJson(response, 400, { error: 'Total biaya harus berupa Rupiah positif.' });
      return;
    }
    if (!isValidDate(date)) {
      View.sendJson(response, 400, { error: 'Tanggal pembelian tidak valid.' });
      return;
    }

    try {
      const item = database.purchaseInventory(request.user.id, {
        itemId,
        itemName,
        unit,
        quantityMilli,
        quantityLabel: quantityValue,
        amountRupiah,
        date
      });
      View.sendJson(response, 201, {
        item: {
          ...item,
          quantity: item.quantity_milli / 1000,
          averageUnitCostRupiah: item.average_unit_cost_micros / 1_000_000
        }
      });
    } catch (error) {
      if (error.code === 'INVENTORY_ITEM_NOT_FOUND') {
        View.sendJson(response, 404, { error: error.message });
        return;
      }
      if (error.code === 'INVENTORY_QUANTITY_LIMIT' || error.code === 'INVENTORY_COST_LIMIT') {
        View.sendJson(response, 400, { error: error.message });
        return;
      }
      if (error.code === 'ERR_SQLITE_ERROR' && String(error.message).includes('UNIQUE constraint failed: inventory_items')) {
        View.sendJson(response, 409, { error: 'Bahan dengan nama dan satuan tersebut sudah ada. Pilih bahan itu untuk menambah stok.' });
        return;
      }
      throw error;
    }
  }

  return { page, list, purchase };
}

module.exports = { createInventoryController, parseQuantity, isValidDate };

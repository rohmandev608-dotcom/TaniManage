const View = require('../core/View');

const ACTIVE_NAV_CLASS = 'flex items-center space-x-3 px-4 py-3 rounded-xl bg-emerald-600 text-white shadow-md';
const INACTIVE_NAV_CLASS = 'flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white transition';

function dashboard(request, response) {
  View.redirect(response, `/${request.user.role}`);
}

async function farmer(request, response, database) {
  const dashboard = await database.getFarmerDashboardForOwner(request.user.id);
  View.render(response, 'dashboard/farmer.html', {
    name: request.user.name,
    csrfToken: request.session.csrfToken,
    pageTitle: 'Dashboard Pertanian',
    fieldCount: dashboard.fieldCount,
    totalAreaHectares: dashboard.totalAreaHectares.toLocaleString('id-ID', { maximumFractionDigits: 2 }),
    activeCycleCount: dashboard.activeCycleCount,
    inventoryItemCount: dashboard.inventoryItemCount,
    activeCycleNetProfit: dashboard.activeCycleNetProfitRupiah.toLocaleString('id-ID'),
    dashboardDataEncoded: encodeURIComponent(JSON.stringify(dashboard)),
    dashboardNavClass: ACTIVE_NAV_CLASS,
    landNavClass: INACTIVE_NAV_CLASS,
    financeNavClass: '',
    activityNavClass: '',
    inventoryNavClass: '',
    cropCycleNavClass: INACTIVE_NAV_CLASS
  });
}

async function farmerData(request, response, database) {
  View.sendJson(response, 200, await database.getFarmerDashboardForOwner(request.user.id));
}

function worker(request, response) {
  View.render(response, 'dashboard/worker.html', {
    name: request.user.name,
    csrfToken: request.session.csrfToken
  });
}

function admin(request, response) {
  View.render(response, 'dashboard/admin.html', {
    name: request.user.name,
    csrfToken: request.session.csrfToken
  });
}

module.exports = { dashboard, farmer, farmerData, worker, admin };

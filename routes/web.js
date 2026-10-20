const HomeController = require('../app/controllers/HomeController');
const DashboardController = require('../app/controllers/DashboardController');
const { createAuthController } = require('../app/controllers/AuthController');
const { createAdminController } = require('../app/controllers/AdminController');
const { createWorkerController } = require('../app/controllers/WorkerController');
const { createOwnerWorkerController } = require('../app/controllers/OwnerWorkerController');
const { createLandController } = require('../app/controllers/LandController');
const { createFinanceController } = require('../app/controllers/FinanceController');
const { createInventoryController } = require('../app/controllers/InventoryController');
const { createFieldActivityController } = require('../app/controllers/FieldActivityController');
const { createCropCycleController } = require('../app/controllers/CropCycleController');
const { requireAuth, requireRoles, requireCsrf, requireOwner } = require('../app/middleware/auth');
const View = require('../app/core/View');
const supabaseHealth = require('../api/supabase-health');

function registerWebRoutes(router, { database, sessions }) {
  const auth = createAuthController(database, sessions);
  const admin = createAdminController(database);
  const worker = createWorkerController(database);
  const ownerWorkers = createOwnerWorkerController(database);
  const lands = createLandController(database);
  const finance = createFinanceController(database);
  const inventory = createInventoryController(database);
  const fieldActivities = createFieldActivityController(database);
  const cropCycles = createCropCycleController(database);

  router.get('/styles.css', (request, response) => View.sendStylesheet(response));
  router.get('/api/supabase-health', supabaseHealth);
  router.get('/', HomeController.index);
  router.get('/register', auth.registerPage);
  router.post('/register', requireCsrf, auth.register);
  router.get('/login', auth.loginPage);
  router.post('/login', requireCsrf, auth.login);
  router.post('/logout', requireAuth, requireCsrf, auth.logout);

  router.get('/dashboard', requireAuth, DashboardController.dashboard);
  router.get('/farmer', requireRoles('farmer'), (request, response) => {
    DashboardController.farmer(request, response, database);
  });
  router.get('/api/farmer/dashboard', requireRoles('farmer'), (request, response) => {
    DashboardController.farmerData(request, response, database);
  });
  router.get('/farmer/lands', requireRoles('farmer'), lands.listPage);
  router.get('/farmer/lands/new', requireRoles('farmer'), lands.newPage);
  router.post('/farmer/lands', requireRoles('farmer'), requireCsrf, lands.create);
  router.get('/farmer/lands/:id/edit', requireRoles('farmer'), lands.editPage);
  router.post('/farmer/lands/:id/update', requireRoles('farmer'), requireCsrf, lands.update);
  router.post('/farmer/lands/:id/delete', requireRoles('farmer'), requireCsrf, lands.remove);
  router.get('/api/farmer/lands', requireRoles('farmer'), lands.list);
  router.get('/api/farmer/lands/:id', requireRoles('farmer'), lands.show);
  router.get('/farmer/finance', requireRoles('farmer'), finance.page);
  router.get('/api/farmer/finance', requireRoles('farmer'), finance.list);
  router.post('/api/farmer/finance', requireRoles('farmer'), requireCsrf, finance.create);
  router.get('/farmer/crop-cycles', requireRoles('farmer'), cropCycles.page);
  router.get('/api/farmer/crop-cycles', requireRoles('farmer'), cropCycles.list);
  router.post('/api/farmer/crop-cycles', requireRoles('farmer'), requireCsrf, cropCycles.create);
  router.get('/api/farmer/crop-cycles/:id/report', requireRoles('farmer'), cropCycles.report);
  router.post('/api/farmer/crop-cycles/:id/complete', requireRoles('farmer'), requireCsrf, cropCycles.complete);
  router.get('/farmer/inventory', requireRoles('farmer'), inventory.page);
  router.get('/api/farmer/inventory', requireRoles('farmer'), inventory.list);
  router.post('/api/farmer/inventory/purchases', requireRoles('farmer'), requireCsrf, inventory.purchase);
  router.get('/farmer/activities', requireRoles('farmer'), fieldActivities.page);
  router.get('/api/farmer/activities', requireRoles('farmer'), fieldActivities.list);
  router.post('/api/farmer/activities', requireRoles('farmer'), requireCsrf, fieldActivities.create);
  router.get('/farmer/workers', requireRoles('farmer'), ownerWorkers.page);
  router.get('/api/farmer/workers', requireRoles('farmer'), ownerWorkers.list);
  router.post('/api/farmer/workers/assign', requireRoles('farmer'), requireCsrf, ownerWorkers.assign);
  router.post('/api/farmer/workers/:workerId/remove', requireRoles('farmer'), requireCsrf, ownerWorkers.remove);
  router.get('/worker', requireRoles('worker'), DashboardController.worker);
  router.get('/worker/join', requireRoles('worker'), DashboardController.worker);
  router.get('/admin', requireRoles('admin'), DashboardController.admin);
  router.get('/worker/tasks', requireRoles('worker'), DashboardController.worker);
  router.get('/api/worker/assignments', requireRoles('worker'), worker.listAssignedResources);
  router.post('/api/worker/join', requireRoles('worker'), requireCsrf, worker.joinOwner);
  router.post('/api/worker/field-activities', requireRoles('worker'), requireCsrf, worker.createFieldActivity);
  router.get('/api/worker/activities', requireRoles('worker'), worker.listActivities);
  router.post('/api/worker/activities', requireRoles('worker'), requireCsrf, worker.createActivity);

  router.get('/api/me', requireAuth, (request, response) => {
    View.sendJson(response, 200, { user: request.user });
  });
  router.get('/api/farmer/users/:userId', requireRoles('farmer'), requireOwner(), async (request, response) => {
    View.sendJson(response, 200, {
      user: await database.getPublicUserById(request.user.id)
    });
  });
  router.get('/api/admin/users', requireRoles('admin'), admin.listUsers);
  router.post('/admin/users/role', requireRoles('admin'), requireCsrf, admin.changeRole);
}

module.exports = registerWebRoutes;

module.exports = registerWebRoutes;

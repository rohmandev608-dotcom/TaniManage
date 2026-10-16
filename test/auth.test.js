const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

function readCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'form should include a CSRF token');
  return match[1];
}

test('registration, session, and role guards work end-to-end', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const registerPage = await fetch(`${origin}/register`, { redirect: 'manual' });
  const anonymousCookie = registerPage.headers.getSetCookie()[0].split(';')[0];
  const pageHtml = await registerPage.text();
  const csrf = readCsrf(pageHtml);

  const selfPromotion = await fetch(`${origin}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: anonymousCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      name: 'Akun Uji',
      email: 'admin-attempt@example.test',
      password: 'password-kuat-123',
      role: 'admin'
    })
  });
  assert.equal(selfPromotion.status, 200);
  assert.match(await selfPromotion.text(), /Peran pendaftaran tidak valid/);

  const registration = await fetch(`${origin}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: anonymousCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      name: '<Petani Uji>',
      email: 'worker@example.test',
      password: 'password-kuat-123',
      role: 'worker'
    })
  });
  assert.equal(registration.status, 303);
  assert.equal(registration.headers.get('location'), '/dashboard');
  const workerCookie = registration.headers.getSetCookie()[0].split(';')[0];

  const dashboard = await fetch(`${origin}/dashboard`, {
    headers: { Cookie: workerCookie },
    redirect: 'manual'
  });
  assert.equal(dashboard.status, 303);
  assert.equal(dashboard.headers.get('location'), '/worker');

  const workerPage = await fetch(`${origin}/worker`, { headers: { Cookie: workerCookie } });
  assert.equal(workerPage.status, 200);
  const workerHtml = await workerPage.text();
  assert.match(workerHtml, /&lt;Petani Uji&gt;/);
  const activityResponse = await fetch(`${origin}/api/worker/activities`, {
    method: 'POST',
    headers: {
      Cookie: workerCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: readCsrf(workerHtml),
      activityDate: '2026-10-15',
      activity: '<script>alert(1)</script>'
    })
  });
  assert.equal(activityResponse.status, 201);
  assert.equal((await activityResponse.json()).activity.activity, '<script>alert(1)</script>');
  const savedActivities = await fetch(`${origin}/api/worker/activities`, {
    headers: { Cookie: workerCookie }
  });
  assert.equal((await savedActivities.json()).activities.length, 1);

  const blockedFarmerPage = await fetch(`${origin}/farmer`, {
    headers: { Cookie: workerCookie },
    redirect: 'manual'
  });
  assert.equal(blockedFarmerPage.status, 403);

  const ownFarmerApi = await fetch(`${origin}/api/farmer/users/1`, {
    headers: { Cookie: workerCookie },
    redirect: 'manual'
  });
  assert.equal(ownFarmerApi.status, 403);

  const me = await fetch(`${origin}/api/me`, { headers: { Cookie: workerCookie } });
  assert.deepEqual(await me.json(), {
    user: { id: 1, name: '<Petani Uji>', email: 'worker@example.test', role: 'worker' }
  });
});

test('POST requests without a valid CSRF token are rejected', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'any@example.test', password: 'not-a-password' }),
    redirect: 'manual'
  });
  assert.equal(response.status, 403);
});

test('admin login can manage roles without allowing removal of the last admin', async (context) => {
  const server = createServer({
    databasePath: ':memory:',
    bootstrap: {
      BOOTSTRAP_ADMIN_NAME: 'Admin Uji',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
      BOOTSTRAP_ADMIN_PASSWORD: 'password-admin-kuat'
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const loginPage = await fetch(`${origin}/login`);
  const anonymousCookie = loginPage.headers.getSetCookie()[0].split(';')[0];
  const login = await fetch(`${origin}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: anonymousCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: readCsrf(await loginPage.text()),
      email: 'admin@example.test',
      password: 'password-admin-kuat'
    })
  });
  assert.equal(login.status, 303);
  const adminCookie = login.headers.getSetCookie()[0].split(';')[0];

  const registerPage = await fetch(`${origin}/register`);
  const workerCookie = registerPage.headers.getSetCookie()[0].split(';')[0];
  const workerRegistration = await fetch(`${origin}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: workerCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: readCsrf(await registerPage.text()),
      name: 'Pekerja Contoh',
      email: 'pekerja@example.test',
      password: 'password-pekerja-kuat',
      role: 'worker'
    })
  });
  assert.equal(workerRegistration.status, 303);
  const registeredWorkerCookie = workerRegistration.headers.getSetCookie()[0].split(';')[0];

  const adminPage = await fetch(`${origin}/admin`, { headers: { Cookie: adminCookie } });
  assert.equal(adminPage.status, 200);
  const adminCsrf = readCsrf(await adminPage.text());
  const users = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: adminCookie } });
  assert.deepEqual((await users.json()).users.map((user) => user.role), ['admin', 'worker']);

  const changeRole = await fetch(`${origin}/admin/users/role`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: adminCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: adminCsrf, userId: '2', role: 'farmer' })
  });
  assert.equal(changeRole.status, 303);

  const formerWorkerRoute = await fetch(`${origin}/worker`, {
    headers: { Cookie: registeredWorkerCookie },
    redirect: 'manual'
  });
  assert.equal(formerWorkerRoute.status, 403);
  const addLandPage = await fetch(`${origin}/farmer/lands/new`, {
    headers: { Cookie: registeredWorkerCookie }
  });
  assert.equal(addLandPage.status, 200);
  const addLandHtml = await addLandPage.text();
  assert.match(addLandHtml, /Tambah Lahan Baru/);
  assert.match(addLandHtml, /id="sidebar"/);
  assert.match(addLandHtml, /id="menuToggle"/);
  assert.match(addLandHtml, /Pekerja Contoh/);
  const farmerDashboard = await fetch(`${origin}/farmer`, {
    headers: { Cookie: registeredWorkerCookie }
  });
  assert.equal(farmerDashboard.status, 200);
  const farmerHtml = await farmerDashboard.text();
  assert.match(farmerHtml, /Dashboard Pertanian/);
  assert.match(farmerHtml, /Pekerja Contoh/);
  assert.match(farmerHtml, /id="sidebar"/);
  const ownData = await fetch(`${origin}/api/farmer/users/2`, {
    headers: { Cookie: registeredWorkerCookie }
  });
  assert.equal(ownData.status, 200);
  const otherUsersData = await fetch(`${origin}/api/farmer/users/1`, {
    headers: { Cookie: registeredWorkerCookie },
    redirect: 'manual'
  });
  assert.equal(otherUsersData.status, 404);

  const demoteLastAdmin = await fetch(`${origin}/admin/users/role`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: adminCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: adminCsrf, userId: '1', role: 'farmer' })
  });
  assert.equal(demoteLastAdmin.status, 409);
});

test('farmers can create, view, update, and delete only their own lands', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;

  async function registerFarmer(email, displayName) {
    const page = await fetch(`${origin}/register`);
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const csrf = readCsrf(await page.text());
    const response = await fetch(`${origin}/register`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        _csrf: csrf,
        name: displayName,
        email,
        password: 'password-farmer-123',
        role: 'farmer'
      })
    });
    assert.equal(response.status, 303);
    const dashboard = await fetch(`${origin}/farmer`, {
      headers: { Cookie: response.headers.getSetCookie()[0].split(';')[0] }
    });
    assert.equal(dashboard.status, 200);
    return {
      cookie: response.headers.getSetCookie()[0].split(';')[0],
      csrf: readCsrf(await dashboard.text())
    };
  }

  const farmerA = await registerFarmer('farmer-a@example.test', 'Petani A');
  const farmerB = await registerFarmer('farmer-b@example.test', 'Petani B');
  const landInput = {
    _csrf: farmerA.csrf,
    name: '<Petak Utara>',
    areaHectares: '1.25',
    soilType: 'alluvial',
    commodity: '<Jagung>',
    coordinates: '-8.2192, 114.3691',
    notes: '<Catatan aman>'
  };

  const create = await fetch(`${origin}/farmer/lands`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: farmerA.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(landInput)
  });
  assert.equal(create.status, 303);
  assert.equal(create.headers.get('location'), '/farmer/lands');

  const listPage = await fetch(`${origin}/farmer/lands`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal(listPage.status, 200);
  assert.match(await listPage.text(), /Lahan Saya/);

  const list = await fetch(`${origin}/api/farmer/lands`, {
    headers: { Cookie: farmerA.cookie }
  });
  const [{ id: landId, name: createdName }] = (await list.json()).lands;
  assert.equal(createdName, '<Petak Utara>');

  const otherFarmersList = await fetch(`${origin}/api/farmer/lands`, {
    headers: { Cookie: farmerB.cookie }
  });
  assert.deepEqual((await otherFarmersList.json()).lands, []);
  const otherFarmersDetail = await fetch(`${origin}/api/farmer/lands/${landId}`, {
    headers: { Cookie: farmerB.cookie }
  });
  assert.equal(otherFarmersDetail.status, 404);

  const forbiddenEdit = await fetch(`${origin}/farmer/lands/${landId}/edit`, {
    headers: { Cookie: farmerB.cookie }
  });
  assert.equal(forbiddenEdit.status, 404);
  const forbiddenDelete = await fetch(`${origin}/farmer/lands/${landId}/delete`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: farmerB.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: farmerB.csrf })
  });
  assert.equal(forbiddenDelete.status, 404);

  const editPage = await fetch(`${origin}/farmer/lands/${landId}/edit`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal(editPage.status, 200);
  const editHtml = await editPage.text();
  assert.match(editHtml, /value="&lt;Petak Utara&gt;"/);
  assert.match(editHtml, /value="1.25"/);
  assert.match(editHtml, /value="&lt;Jagung&gt;"/);

  const update = await fetch(`${origin}/farmer/lands/${landId}/update`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: farmerA.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      ...landInput,
      name: 'Petak Selatan',
      areaHectares: '2'
    })
  });
  assert.equal(update.status, 303);

  const updatedList = await fetch(`${origin}/api/farmer/lands`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal((await updatedList.json()).lands[0].name, 'Petak Selatan');

  const invalidCreate = await fetch(`${origin}/farmer/lands`, {
    method: 'POST',
    headers: {
      Cookie: farmerA.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      ...landInput,
      coordinates: '91, 200'
    })
  });
  assert.equal(invalidCreate.status, 200);
  assert.match(await invalidCreate.text(), /Koordinat harus berupa lintang/);

  const remove = await fetch(`${origin}/farmer/lands/${landId}/delete`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: farmerA.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: farmerA.csrf })
  });
  assert.equal(remove.status, 303);
  const deletedList = await fetch(`${origin}/api/farmer/lands`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.deepEqual((await deletedList.json()).lands, []);
});

test('farmers can record field-based finance and filter private reports', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;

  async function createFarmer(email, name) {
    const registerPage = await fetch(`${origin}/register`);
    const anonymousCookie = registerPage.headers.getSetCookie()[0].split(';')[0];
    const registerCsrf = readCsrf(await registerPage.text());
    const registration = await fetch(`${origin}/register`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: anonymousCookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        _csrf: registerCsrf,
        name,
        email,
        password: 'password-farmer-123'
      })
    });
    assert.equal(registration.status, 303);
    const cookie = registration.headers.getSetCookie()[0].split(';')[0];
    const dashboard = await fetch(`${origin}/farmer`, { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    return { cookie, csrf: readCsrf(await dashboard.text()) };
  }

  async function createLand(farmer, name) {
    const response = await fetch(`${origin}/farmer/lands`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: farmer.cookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        _csrf: farmer.csrf,
        name,
        areaHectares: '1',
        soilType: 'alluvial'
      })
    });
    assert.equal(response.status, 303);
    const lands = await fetch(`${origin}/api/farmer/lands`, {
      headers: { Cookie: farmer.cookie }
    });
    return (await lands.json()).lands[0].id;
  }

  async function createTransaction(farmer, transaction) {
    return fetch(`${origin}/api/farmer/finance`, {
      method: 'POST',
      headers: {
        Cookie: farmer.cookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ _csrf: farmer.csrf, ...transaction })
    });
  }

  async function startCycle(farmer, fieldId, commodityName = 'Padi') {
    return fetch(`${origin}/api/farmer/crop-cycles`, {
      method: 'POST',
      headers: {
        Cookie: farmer.cookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        _csrf: farmer.csrf,
        fieldId: String(fieldId),
        commodityName,
        startDate: '2020-01-01',
        expectedHarvestDate: '2020-06-01'
      })
    });
  }

  const farmerA = await createFarmer('finance-a@example.test', 'Petani Finansial');
  const farmerB = await createFarmer('finance-b@example.test', 'Petani Lain');
  const fieldA = await createLand(farmerA, 'Sawah Finansial');
  const secondFieldA = await createLand(farmerA, 'Sawah Kedua');
  const fieldB = await createLand(farmerB, 'Sawah Privat');
  const cycleResponse = await startCycle(farmerA, fieldA);
  assert.equal(cycleResponse.status, 201);
  const cycle = (await cycleResponse.json()).cycle;
  assert.equal((await startCycle(farmerA, fieldA, 'Jagung')).status, 409);
  const dashboardDataResponse = await fetch(`${origin}/api/farmer/dashboard`, {
    headers: { Cookie: farmerA.cookie }
  });
  const dashboardData = await dashboardDataResponse.json();
  assert.equal(dashboardDataResponse.status, 200);
  assert.equal(dashboardData.fieldCount, 2);
  assert.equal(dashboardData.totalAreaHectares, 2);
  assert.equal(dashboardData.activeCycleCount, 1);
  assert.equal(dashboardData.activeCycles[0].id, cycle.id);
  assert.equal(dashboardData.inventoryItemCount, 0);
  assert.equal(dashboardData.activeCycleNetProfitRupiah, 0);
  assert.deepEqual(dashboardData.recentActivities, []);
  const dashboardPage = await fetch(`${origin}/farmer`, {
    headers: { Cookie: farmerA.cookie }
  });
  const dashboardHtml = await dashboardPage.text();
  assert.match(dashboardHtml, /Hektar \(2 Petak\)/);
  assert.match(dashboardHtml, /id="activeCycleList"/);
  assert.match(dashboardHtml, /data-dashboard="%7B/);
  assert.doesNotMatch(dashboardHtml, /fetch\('\/api\/farmer\/dashboard'\)/);

  const financePage = await fetch(`${origin}/farmer/finance`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal(financePage.status, 200);
  const financeHtml = await financePage.text();
  assert.match(financeHtml, /Filter lahan/);
  assert.match(financeHtml, /Pemasukan/);
  assert.match(financeHtml, /Riwayat Transaksi/);
  const cyclePage = await fetch(`${origin}/farmer/crop-cycles`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal(cyclePage.status, 200);
  assert.match(await cyclePage.text(), /Mulai Musim Tanam/);

  const expense = await createTransaction(farmerA, {
    fieldId: String(fieldA),
    type: 'expense',
    category: 'Beli Pupuk',
    date: '2026-10-10',
    amountRupiah: '150000',
    description: 'Pupuk awal musim'
  });
  assert.equal(expense.status, 201);
  assert.equal((await expense.json()).transaction.crop_cycle_id, cycle.id);
  const income = await createTransaction(farmerA, {
    fieldId: String(fieldA),
    type: 'income',
    category: 'Penjualan Panen',
    date: '2026-10-15',
    amountRupiah: '500000',
    description: 'Panen jagung'
  });
  assert.equal(income.status, 201);
  assert.equal((await income.json()).transaction.crop_cycle_id, cycle.id);
  const unassigned = await createTransaction(farmerA, {
    fieldId: '',
    type: 'expense',
    category: 'Transportasi',
    date: '2026-10-15',
    amountRupiah: '50000',
    description: 'Biaya umum'
  });
  assert.equal(unassigned.status, 201);

  const all = await fetch(`${origin}/api/farmer/finance`, {
    headers: { Cookie: farmerA.cookie }
  });
  const allData = await all.json();
  assert.equal(allData.transactions.length, 3);
  assert.deepEqual(allData.summary, {
    totalIncome: 500000,
    totalExpense: 200000,
    netProfit: 300000,
    profitMargin: 60
  });
  assert.ok(allData.fields.some((field) => field.id === fieldA));

  const onlyField = await fetch(`${origin}/api/farmer/finance?fieldId=${fieldA}`, {
    headers: { Cookie: farmerA.cookie }
  });
  const fieldData = await onlyField.json();
  assert.equal(fieldData.transactions.length, 2);
  assert.equal(fieldData.summary.totalExpense, 150000);
  assert.equal(fieldData.summary.netProfit, 350000);
  const cycleFinance = await fetch(
    `${origin}/api/farmer/finance?cropCycleId=${cycle.id}`,
    { headers: { Cookie: farmerA.cookie } }
  );
  const cycleFinanceData = await cycleFinance.json();
  assert.equal(cycleFinance.status, 200);
  assert.deepEqual(cycleFinanceData.summary, fieldData.summary);
  assert.equal(cycleFinanceData.transactions.length, 2);

  const noField = await fetch(`${origin}/api/farmer/finance?fieldId=unassigned`, {
    headers: { Cookie: farmerA.cookie }
  });
  assert.equal((await noField.json()).transactions.length, 1);

  const otherOwnerField = await createTransaction(farmerA, {
    fieldId: String(fieldB),
    type: 'income',
    category: 'Penjualan Panen',
    date: '2026-10-15',
    amountRupiah: '999999'
  });
  assert.equal(otherOwnerField.status, 404);

  const invalidCategory = await createTransaction(farmerA, {
    fieldId: String(fieldA),
    type: 'income',
    category: 'Beli Pupuk',
    date: '2026-10-15',
    amountRupiah: '1000'
  });
  assert.equal(invalidCategory.status, 400);

  const invalidDate = await createTransaction(farmerA, {
    fieldId: String(fieldA),
    type: 'expense',
    category: 'Bibit',
    date: '2026-02-30',
    amountRupiah: '1000'
  });
  assert.equal(invalidDate.status, 400);

  const anotherFarmerData = await fetch(`${origin}/api/farmer/finance`, {
    headers: { Cookie: farmerB.cookie }
  });
  const otherData = await anotherFarmerData.json();
  assert.equal(otherData.transactions.length, 0);
  assert.deepEqual(otherData.summary, {
    totalIncome: 0,
    totalExpense: 0,
    netProfit: 0,
    profitMargin: 0
  });

  const reportResponse = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/report`, {
    headers: { Cookie: farmerA.cookie }
  });
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200);
  assert.deepEqual(report.summary, cycleFinanceData.summary);
  const complete = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/complete`, {
    method: 'POST',
    headers: {
      Cookie: farmerA.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: farmerA.csrf })
  });
  assert.equal(complete.status, 200);
  const completedCycle = (await complete.json()).cycle;
  assert.equal(completedCycle.status, 'completed');
  assert.equal(completedCycle.final_profit_rupiah, 350000);
  const lateTransaction = await createTransaction(farmerA, {
    fieldId: String(fieldA),
    type: 'expense',
    category: 'Bibit',
    date: '2026-10-15',
    amountRupiah: '1000'
  });
  assert.equal(lateTransaction.status, 409);
  const finalReport = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/report`, {
    headers: { Cookie: farmerA.cookie }
  });
  const finalReportData = await finalReport.json();
  assert.deepEqual(finalReportData.summary, cycleFinanceData.summary);
  const privateReport = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/report`, {
    headers: { Cookie: farmerB.cookie }
  });
  assert.equal(privateReport.status, 404);
  const invalidCycleField = await fetch(
    `${origin}/api/farmer/finance?fieldId=${secondFieldA}&cropCycleId=${cycle.id}`,
    { headers: { Cookie: farmerA.cookie } }
  );
  assert.equal(invalidCycleField.status, 400);
  const nextCycle = await startCycle(farmerA, fieldA, 'Jagung');
  assert.equal(nextCycle.status, 201);
  assert.notEqual((await nextCycle.json()).cycle.id, cycle.id);
});

test('inventory purchases and field usage commit or roll back together', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const registerPage = await fetch(`${origin}/register`);
  const anonymousCookie = registerPage.headers.getSetCookie()[0].split(';')[0];
  const registration = await fetch(`${origin}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: anonymousCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: readCsrf(await registerPage.text()),
      name: 'Petani Integrasi',
      email: 'integration@example.test',
      password: 'password-integrasi-123'
    })
  });
  assert.equal(registration.status, 303);
  const cookie = registration.headers.getSetCookie()[0].split(';')[0];
  const dashboard = await fetch(`${origin}/farmer`, { headers: { Cookie: cookie } });
  const csrf = readCsrf(await dashboard.text());
  const inventoryPage = await fetch(`${origin}/farmer/inventory`, {
    headers: { Cookie: cookie }
  });
  assert.equal(inventoryPage.status, 200);
  assert.match(await inventoryPage.text(), /Catat Pembelian \/ Stok Masuk/);
  const activityPage = await fetch(`${origin}/farmer/activities`, {
    headers: { Cookie: cookie }
  });
  assert.equal(activityPage.status, 200);
  assert.match(await activityPage.text(), /Catat Aktivitas/);

  const createLand = await fetch(`${origin}/farmer/lands`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      name: 'Blok Pemupukan',
      areaHectares: '1',
      soilType: 'alluvial'
    })
  });
  assert.equal(createLand.status, 303);
  const fieldsResponse = await fetch(`${origin}/api/farmer/lands`, { headers: { Cookie: cookie } });
  const [{ id: fieldId }] = (await fieldsResponse.json()).lands;
  const noSeasonActivity = await fetch(`${origin}/api/farmer/activities`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      fieldId: String(fieldId),
      activityType: 'Pemupukan',
      date: '2026-10-15'
    })
  });
  assert.equal(noSeasonActivity.status, 409);
  const startCycle = await fetch(`${origin}/api/farmer/crop-cycles`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      fieldId: String(fieldId),
      commodityName: 'Padi',
      startDate: '2020-01-01'
    })
  });
  assert.equal(startCycle.status, 201);
  const cycle = (await startCycle.json()).cycle;

  const firstPurchase = await fetch(`${origin}/api/farmer/inventory/purchases`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      itemId: '',
      itemName: 'Pupuk NPK',
      unit: 'kg',
      quantity: '10',
      amountRupiah: '100000',
      date: '2026-10-10'
    })
  });
  assert.equal(firstPurchase.status, 201);
  const firstItem = (await firstPurchase.json()).item;
  assert.equal(firstItem.quantity, 10);
  assert.equal(firstItem.averageUnitCostRupiah, 10000);

  const restock = await fetch(`${origin}/api/farmer/inventory/purchases`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      itemId: String(firstItem.id),
      quantity: '10',
      amountRupiah: '200000',
      date: '2026-10-12'
    })
  });
  assert.equal(restock.status, 201);
  const restockedItem = (await restock.json()).item;
  assert.equal(restockedItem.quantity, 20);
  assert.equal(restockedItem.averageUnitCostRupiah, 15000);

  const insufficientUsage = await fetch(`${origin}/api/farmer/activities`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      fieldId: String(fieldId),
      activityType: 'Pemupukan',
      date: '2026-10-15',
      itemId: String(firstItem.id),
      quantity: '21',
      description: 'Harus gagal karena stok tidak cukup'
    })
  });
  assert.equal(insufficientUsage.status, 409);
  assert.match((await insufficientUsage.json()).error, /Stok gudang tidak mencukupi/);
  const noActivityAfterFailure = await fetch(`${origin}/api/farmer/activities`, {
    headers: { Cookie: cookie }
  });
  assert.deepEqual((await noActivityAfterFailure.json()).activities, []);
  const stockAfterFailure = await fetch(`${origin}/api/farmer/inventory`, {
    headers: { Cookie: cookie }
  });
  assert.equal((await stockAfterFailure.json()).items[0].quantity, 20);

  const usage = await fetch(`${origin}/api/farmer/activities`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      fieldId: String(fieldId),
      activityType: 'Pemupukan',
      date: '2026-10-15',
      itemId: String(firstItem.id),
      quantity: '3',
      description: 'Pemupukan susulan'
    })
  });
  assert.equal(usage.status, 201);
  const usageResult = (await usage.json()).activity;
  assert.equal(usageResult.consumedItem.costRupiah, 45000);
  assert.equal(usageResult.cropCycleId, cycle.id);

  const finalStock = await fetch(`${origin}/api/farmer/inventory`, {
    headers: { Cookie: cookie }
  });
  assert.equal((await finalStock.json()).items[0].quantity, 17);
  const activityList = await fetch(`${origin}/api/farmer/activities`, {
    headers: { Cookie: cookie }
  });
  const [savedActivity] = (await activityList.json()).activities;
  assert.equal(savedActivity.field_id, fieldId);
  assert.equal(savedActivity.crop_cycle_id, cycle.id);
  assert.equal(savedActivity.total_cost_rupiah, 45000);

  const finance = await fetch(`${origin}/api/farmer/finance`, {
    headers: { Cookie: cookie }
  });
  const financeResult = await finance.json();
  assert.equal(financeResult.transactions.length, 3);
  assert.equal(financeResult.summary.totalExpense, 45000);
  assert.equal(financeResult.transactions.filter((transaction) => transaction.field_id === null).length, 2);
  const usageTransaction = financeResult.transactions.find((transaction) => transaction.category === 'Pemakaian Inventaris');
  assert.equal(usageTransaction.crop_cycle_id, cycle.id);
  const cycleReportResponse = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/report`, {
    headers: { Cookie: cookie }
  });
  const cycleReport = await cycleReportResponse.json();
  assert.equal(cycleReport.summary.totalExpense, 45000);
  assert.equal(cycleReport.activities.length, 1);
  const landFinance = await fetch(`${origin}/api/farmer/finance?fieldId=${fieldId}`, {
    headers: { Cookie: cookie }
  });
  assert.equal((await landFinance.json()).transactions.length, 1);
  const closeCycle = await fetch(`${origin}/api/farmer/crop-cycles/${cycle.id}/complete`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.equal(closeCycle.status, 200);
  const lateActivity = await fetch(`${origin}/api/farmer/activities`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrf,
      fieldId: String(fieldId),
      activityType: 'Pemupukan',
      date: '2026-10-16',
      itemId: String(firstItem.id),
      quantity: '1'
    })
  });
  assert.equal(lateActivity.status, 409);
  const stockAfterClose = await fetch(`${origin}/api/farmer/inventory`, {
    headers: { Cookie: cookie }
  });
  assert.equal((await stockAfterClose.json()).items[0].quantity, 17);
});

test('owners invite and assign workers without exposing finance data to workers', async (context) => {
  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function register(role, email, name) {
    const page = await fetch(`${origin}/register`);
    const anonymousCookie = page.headers.getSetCookie()[0].split(';')[0];
    const registration = await fetch(`${origin}/register`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: anonymousCookie,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        _csrf: readCsrf(await page.text()),
        name,
        email,
        password: 'password-pertanian-123',
        role
      })
    });
    assert.equal(registration.status, 303);
    const cookie = registration.headers.getSetCookie()[0].split(';')[0];
    const dashboard = await fetch(`${origin}/${role}`, { headers: { Cookie: cookie } });
    return { cookie, csrf: readCsrf(await dashboard.text()) };
  }

  const owner = await register('farmer', 'owner-workers@example.test', 'Owner Kebun');
  const worker = await register('worker', 'worker-team@example.test', 'Buruh Kebun');
  const landResponse = await fetch(`${origin}/farmer/lands`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: owner.csrf,
      name: 'Petak Pekerja',
      areaHectares: '1',
      soilType: '',
      commodity: 'Jagung',
      coordinates: '',
      notes: ''
    })
  });
  assert.equal(landResponse.status, 303);
  const lands = await fetch(`${origin}/api/farmer/lands`, { headers: { Cookie: owner.cookie } });
  const fieldId = (await lands.json()).lands[0].id;
  const cycleResponse = await fetch(`${origin}/api/farmer/crop-cycles`, {
    method: 'POST',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: owner.csrf,
      fieldId: String(fieldId),
      commodityName: 'Jagung',
      startDate: '2026-10-01'
    })
  });
  assert.equal(cycleResponse.status, 201);
  const cycleId = (await cycleResponse.json()).cycle.id;

  const management = await fetch(`${origin}/farmer/workers`, { headers: { Cookie: owner.cookie } });
  assert.equal(management.status, 200);
  assert.match(await management.text(), /Ajak buruh bergabung/);
  const inviteResponse = await fetch(`${origin}/api/farmer/workers`, {
    headers: { Cookie: owner.cookie }
  });
  const invite = (await inviteResponse.json()).invite;
  const inviteCode = new URL(invite.joinUrl, origin).searchParams.get('invite');
  assert.match(inviteCode, /^[A-Za-z0-9_-]{40,50}$/);

  const join = await fetch(`${origin}/api/worker/join`, {
    method: 'POST',
    headers: {
      Cookie: worker.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: worker.csrf, inviteCode })
  });
  assert.equal(join.status, 200);
  assert.equal((await join.json()).membership.owner.name, 'Owner Kebun');
  const assign = await fetch(`${origin}/api/farmer/workers/assign`, {
    method: 'POST',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: owner.csrf,
      workerId: '2',
      fieldId: String(fieldId),
      cropCycleId: String(cycleId)
    })
  });
  assert.equal(assign.status, 201);
  const assignmentsResponse = await fetch(`${origin}/api/worker/assignments`, {
    headers: { Cookie: worker.cookie }
  });
  const assignments = await assignmentsResponse.json();
  assert.equal(assignments.assignments.length, 1);
  assert.doesNotMatch(JSON.stringify(assignments), /amount_rupiah|total_cost_rupiah|profit/i);

  const financeAccess = await fetch(`${origin}/api/farmer/finance`, {
    headers: { Cookie: worker.cookie },
    redirect: 'manual'
  });
  assert.equal(financeAccess.status, 403);
  const ownerPageAccess = await fetch(`${origin}/farmer/workers`, {
    headers: { Cookie: worker.cookie },
    redirect: 'manual'
  });
  assert.equal(ownerPageAccess.status, 403);

  const purchase = await fetch(`${origin}/api/farmer/inventory/purchases`, {
    method: 'POST',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: owner.csrf,
      itemName: 'Pupuk NPK',
      unit: 'kg',
      quantity: '10',
      amountRupiah: '50000',
      date: '2026-10-01'
    })
  });
  assert.equal(purchase.status, 201);
  const activity = await fetch(`${origin}/api/worker/field-activities`, {
    method: 'POST',
    headers: {
      Cookie: worker.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: worker.csrf,
      assignmentId: String(assignments.assignments[0].assignment_id),
      activityType: 'Pemupukan',
      date: '2026-10-16',
      itemId: String((await purchase.json()).item.id),
      quantity: '1',
      description: 'Pemupukan susulan'
    })
  });
  assert.equal(activity.status, 201);
  assert.doesNotMatch(JSON.stringify(await activity.json()), /costRupiah|amount_rupiah|total_cost_rupiah/i);
  const stock = await fetch(`${origin}/api/farmer/inventory`, { headers: { Cookie: owner.cookie } });
  assert.equal((await stock.json()).items[0].quantity, 9);
  const finance = await fetch(`${origin}/api/farmer/finance`, { headers: { Cookie: owner.cookie } });
  const expenses = (await finance.json()).transactions;
  assert.equal(expenses.find((entry) => entry.category === 'Pemakaian Inventaris').amount_rupiah, 5000);
  const ownerActivities = await fetch(`${origin}/api/farmer/activities`, {
    headers: { Cookie: owner.cookie }
  });
  assert.equal((await ownerActivities.json()).activities[0].worker_name, 'Buruh Kebun');

  const remove = await fetch(`${origin}/api/farmer/workers/2/remove`, {
    method: 'POST',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ _csrf: owner.csrf })
  });
  assert.equal(remove.status, 200);
  const resourcesAfterRemoval = await fetch(`${origin}/api/worker/assignments`, {
    headers: { Cookie: worker.cookie }
  });
  assert.deepEqual((await resourcesAfterRemoval.json()).assignments, []);
});

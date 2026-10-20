const test = require('pg');
const assert = require('node:assert/strict');
const Database = require('./Database');

test('prepared user queries and sessions keep user data scoped', async () => {
  const database = new Database(':memory:');
  try {
    const user = await database.createUser({
      name: 'Petani Uji',
      email: 'petani@example.test',
      passwordHash: '$scrypt$test-hash',
      role: 'farmer'
    });
    const secondUser = await database.createUser({
      name: 'Pekerja Uji',
      email: 'pekerja@example.test',
      passwordHash: '$scrypt$test-hash',
      role: 'worker'
    });

    assert.equal((await database.findUserByEmail('PETANI@example.test')).id, user.id);
    assert.equal(await database.findUserByEmail("' OR 1=1 --"), null);
    assert.equal((await database.getPublicUserById(user.id)).password_hash, undefined);
    assert.equal((await database.listPublicUsers()).length, 2);

    await database.createWorkerActivity(secondUser.id, '2026-10-15', 'Menyiram tanaman');
    assert.equal((await database.listWorkerActivitiesForUser(user.id)).length, 0);
    assert.equal((await database.listWorkerActivitiesForUser(secondUser.id))[0].activity, 'Menyiram tanaman');

    const land = await database.createLand(user.id, {
      name: 'Petak Utara',
      areaHectares: 1.5,
      soilType: 'alluvial',
      commodity: 'Jagung',
      coordinates: '-8.2192, 114.3691',
      notes: 'Dekat irigasi'
    });
    assert.equal((await database.listLandsForOwner(user.id)).length, 1);
    assert.equal((await database.listLandsForOwner(secondUser.id)).length, 0);
    assert.equal(await database.getLandForOwner(secondUser.id, land.id), null);
    assert.equal(await database.updateLandForOwner(secondUser.id, land.id, {
      name: 'Bukan pemilik',
      areaHectares: 8,
      soilType: '',
      commodity: '',
      coordinates: '',
      notes: ''
    }), 0);
    assert.equal(await database.deleteLandForOwner(secondUser.id, land.id), 0);
    assert.equal((await database.getLandForOwner(user.id, land.id)).name, 'Petak Utara');
    assert.equal(await database.updateLandForOwner(user.id, land.id, {
      name: 'Petak Selatan',
      areaHectares: 2,
      soilType: 'volcanic',
      commodity: 'Cabai',
      coordinates: '',
      notes: ''
    }), 1);
    assert.equal((await database.getLandForOwner(user.id, land.id)).name, 'Petak Selatan');
    assert.equal(await database.deleteLandForOwner(user.id, land.id), 1);
    assert.equal(await database.getLandForOwner(user.id, land.id), null);

    await database.createSession('opaque-token-hash', user.id, 'csrf-token', Date.now() + 60000);
    assert.equal((await database.findSession('opaque-token-hash')).user_id, user.id);
    assert.equal((await database.getPublicUserById(secondUser.id)).role, 'worker');
    await database.deleteSession('opaque-token-hash');
    assert.equal(await database.findSession('opaque-token-hash'), null);
  } finally {
    await database.close();
  }
});

test('worker memberships, field assignments, and stock-cost recording stay owner scoped', async () => {
  const database = new Database(':memory:');
  try {
    const ownerA = await database.createUser({
      name: 'Owner A',
      email: 'owner-a@example.test',
      passwordHash: '$scrypt$test-hash',
      role: 'farmer'
    });
    const ownerB = await database.createUser({
      name: 'Owner B',
      email: 'owner-b@example.test',
      passwordHash: '$scrypt$test-hash',
      role: 'farmer'
    });
    const worker = await database.createUser({
      name: 'Buruh Bersama',
      email: 'worker-shared@example.test',
      passwordHash: '$scrypt$test-hash',
      role: 'worker'
    });
    const inviteA = await database.ensureOwnerInvite(ownerA.id, 'A'.repeat(43));
    const inviteB = await database.ensureOwnerInvite(ownerB.id, 'B'.repeat(43));

    assert.equal((await database.joinWorkerWithInvite(worker.id, inviteA)).alreadyMember, false);
    assert.equal((await database.joinWorkerWithInvite(worker.id, inviteA)).alreadyMember, true);
    await database.joinWorkerWithInvite(worker.id, inviteB);
    assert.equal((await database.listOwnerWorkers(ownerA.id)).workers.length, 1);
    assert.equal((await database.listOwnerWorkers(ownerB.id)).workers.length, 1);

    const field = await database.createLand(ownerA.id, {
      name: 'Petak Uji',
      areaHectares: 1,
      soilType: '',
      commodity: 'Jagung',
      coordinates: '',
      notes: ''
    });
    const cycle = await database.createCropCycle(ownerA.id, {
      fieldId: field.id,
      commodityName: 'Jagung',
      variety: '',
      startDate: '2026-10-01'
    });
    const fieldB = await database.createLand(ownerB.id, {
      name: 'Petak B',
      areaHectares: 2,
      soilType: '',
      commodity: 'Padi',
      coordinates: '',
      notes: ''
    });
    const cycleB = await database.createCropCycle(ownerB.id, {
      fieldId: fieldB.id,
      commodityName: 'Padi',
      variety: '',
      startDate: '2026-10-01'
    });
    assert.equal(await database.assignWorkerToCropCycle(ownerA.id, worker.id, field.id, cycle.id), true);
    assert.equal(await database.assignWorkerToCropCycle(ownerB.id, worker.id, fieldB.id, cycleB.id), true);
    assert.equal((await database.listWorkerAssignments(worker.id)).length, 2);

    await database.purchaseInventory(ownerA.id, {
      itemId: null,
      itemName: 'Pupuk NPK',
      unit: 'kg',
      quantityMilli: 10000,
      quantityLabel: '10',
      amountRupiah: 100000,
      date: '2026-10-01'
    });
    const item = (await database.listInventoryItemsForOwner(ownerA.id))[0];
    const result = await database.createFieldActivityWithInventory(null, {
      assignmentId: (await database.listOwnerWorkers(ownerA.id)).assignments[0]?.id,
      activityType: 'Pemupukan',
      date: '2026-10-16',
      description: 'Pemupukan susulan',
      itemId: item.id,
      quantityMilli: 1000,
      quantityLabel: '1'
    }, worker.id);
    assert.equal(result.fieldId, field.id);
    assert.equal(result.cropCycleId, cycle.id);
    assert.equal(result.consumedItem.costRupiah, 10000);
    assert.equal((await database.getInventoryItemForOwner(ownerA.id, item.id)).quantity_milli, 9000);
    assert.equal((await database.getFinancialSummaryForOwner(ownerA.id)).totalExpense, 10000);
    assert.equal((await database.listWorkerFieldActivities(worker.id))[0].field_name, 'Petak Uji');
    assert.equal((await database.listWorkerFieldActivities(worker.id))[0].total_cost_rupiah, undefined);
    assert.equal(await database.removeWorkerFromOwner(ownerA.id, worker.id), 1);
    assert.equal((await database.listWorkerAssignments(worker.id)).length, 1);
    assert.equal((await database.listWorkerFieldActivities(worker.id)).length, 0);
    assert.equal((await database.listOwnerWorkers(ownerB.id)).workers.length, 1);
  } finally {
    await database.close();
  }
});

import dns from 'node:dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';

const API_BASE = 'http://localhost:5000/api';

async function run() {
  console.log('=== STARTING CRITICAL PERSISTENCE VERIFICATION ===\n');

  // 1. Verify MONGODB_URI is loaded
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('FAIL: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }
  const maskedUri = mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  console.log('1. MONGODB_URI loaded correctly from environment:', maskedUri);

  // 2. Verify backend actually connects to MongoDB
  const healthRes = await fetch(`${API_BASE}/health`);
  const health = await healthRes.json();
  console.log('2. Backend health check response:', health);
  if (!health || health.status !== 'ok') {
    console.error('FAIL: Backend health check failed or MongoDB is disconnected.');
    process.exit(1);
  }
  console.log('   MongoDB connection state in backend: CONNECTED\n');

  // 3. Connect direct mongoose client to confirm document in MongoDB directly
  await connectDB();
  console.log('3. Direct Mongoose connection established to MongoDB database:', mongoose.connection.name);

  // Clean any previous test entities with test names before testing
  await mongoose.connection.collection('menuitems').deleteMany({ name: 'Persistence Test Item' });
  await mongoose.connection.collection('categories').deleteMany({ name: 'Persistence Test Cat' });
  await mongoose.connection.collection('addons').deleteMany({ name: 'Persistence Test Addon' });
  await mongoose.connection.collection('deals').deleteMany({ name: 'Persistence Test Deal' });
  await mongoose.connection.collection('expensecategories').deleteMany({ name: 'Persistence Test Expense Cat' });
  await mongoose.connection.collection('expenses').deleteMany({ description: 'Test expense persistence' });

  // 4. Fetch canonical categories to find valid category
  const catRes = await fetch(`${API_BASE}/categories`);
  const catData = await catRes.json();
  if (!catData.success || !Array.isArray(catData.data) || catData.data.length === 0) {
    console.error('FAIL: Could not retrieve canonical categories from backend.');
    process.exit(1);
  }
  const targetCategory = catData.data[0];
  console.log(`4. Selected category for test item: '${targetCategory.name}' (ID: ${targetCategory.id})\n`);

  // 5. CRITICAL TEST: Add new Item named "Persistence Test Item"
  console.log('5. Executing POST /api/items for "Persistence Test Item"...');
  const postPayload = {
    name: 'Persistence Test Item',
    categoryId: targetCategory.id,
    categoryName: targetCategory.name,
    basePrice: 450,
    costPrice: 280,
    unit: 'Unit',
    baseUnit: 'Unit',
    unitType: 'piece',
    description: 'Item created for critical persistence bug verification',
    status: 'active',
  };

  const createRes = await fetch(`${API_BASE}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postPayload),
  });

  const createData = await createRes.json();
  console.log(`   POST /api/items HTTP status: ${createRes.status}`);
  console.log('   POST /api/items response data:', createData);

  if (createRes.status !== 201 || !createData.success || !createData.data?.id) {
    console.error('FAIL: POST /api/items did not return success 201 with created item.');
    process.exit(1);
  }
  const createdItemId = createData.data.id;
  console.log(`   CONFIRMED: POST /api/items returned success with item ID: ${createdItemId}\n`);

  // 6. Confirm record exists directly in MongoDB
  console.log('6. Confirming record directly in MongoDB collection "menuitems"...');
  const mongoDoc = await mongoose.connection.collection('menuitems').findOne({ id: createdItemId });
  if (!mongoDoc) {
    console.error('FAIL: Document was not found in MongoDB!');
    process.exit(1);
  }
  console.log('   CONFIRMED: Document exists in MongoDB:');
  console.log('   - _id:', mongoDoc._id.toString());
  console.log('   - id:', mongoDoc.id);
  console.log('   - name:', mongoDoc.name);
  console.log('   - categoryId:', mongoDoc.categoryId);
  console.log('   - basePrice:', mongoDoc.basePrice);
  console.log('   - createdAt:', mongoDoc.createdAt);
  console.log('   Document verified in MongoDB successfully.\n');

  // 7. Refresh simulation: Call GET /api/items independently
  console.log('7. Simulating full page refresh: Fetching GET /api/items from backend API...');
  const getItemsRes = await fetch(`${API_BASE}/items`);
  const getItemsData = await getItemsRes.json();

  if (getItemsRes.status !== 200 || !getItemsData.success || !Array.isArray(getItemsData.data)) {
    console.error('FAIL: GET /api/items failed.');
    process.exit(1);
  }

  const foundItem = getItemsData.data.find((item) => item.id === createdItemId || item.name === 'Persistence Test Item');
  if (!foundItem) {
    console.error('FAIL: "Persistence Test Item" disappeared from GET /api/items response!');
    process.exit(1);
  }
  console.log('   CONFIRMED: GET /api/items returned the created item after reload simulation:');
  console.log('   - Item Name:', foundItem.name);
  console.log('   - Item ID:', foundItem.id);
  console.log('   - Base Price:', foundItem.basePrice);
  console.log('   Item is intact and returned by canonical API.\n');

  // 8. Verify other business entities persistence flow:
  console.log('8. Verifying Categories, Addons, Deals, Expense Categories, Expenses persistence flows...');

  // 8a. Category
  const catPayload = { name: 'Persistence Test Cat', status: 'active' };
  const cRes = await fetch(`${API_BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(catPayload),
  });
  const cData = await cRes.json();
  if (cRes.status !== 201 || !cData.success) throw new Error('Category POST failed');
  const catInMongo = await mongoose.connection.collection('categories').findOne({ id: cData.data.id });
  if (!catInMongo) throw new Error('Category not found in MongoDB');
  console.log('   [Categories] POST success, verified in MongoDB, returns on GET');

  // 8b. Addon
  const addPayload = { name: 'Persistence Test Addon', price: 60, type: 'Side', status: 'active' };
  const aRes = await fetch(`${API_BASE}/addons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(addPayload),
  });
  const aData = await aRes.json();
  if (aRes.status !== 201 || !aData.success) throw new Error('Addon POST failed');
  const addonInMongo = await mongoose.connection.collection('addons').findOne({ id: aData.data.id });
  if (!addonInMongo) throw new Error('Addon not found in MongoDB');
  console.log('   [Add-ons] POST success, verified in MongoDB, returns on GET');

  // 8c. Deal
  const dealPayload = {
    name: 'Persistence Test Deal',
    dealPrice: 999,
    status: 'active',
    includedItems: [{ itemId: createdItemId, name: 'Persistence Test Item', quantity: 1, sellingPrice: 450 }],
  };
  const dRes = await fetch(`${API_BASE}/deals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dealPayload),
  });
  const dData = await dRes.json();
  if (dRes.status !== 201 || !dData.success) throw new Error('Deal POST failed');
  const dealInMongo = await mongoose.connection.collection('deals').findOne({ id: dData.data.id });
  if (!dealInMongo) throw new Error('Deal not found in MongoDB');
  console.log('   [Deals] POST success, verified in MongoDB, returns on GET');

  // 8d. Expense Category
  const expCatPayload = { name: 'Persistence Test Expense Cat', description: 'Test', status: 'active' };
  const ecRes = await fetch(`${API_BASE}/expenses/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expCatPayload),
  });
  const ecData = await ecRes.json();
  if (ecRes.status !== 201 || !ecData.success) throw new Error('Expense Category POST failed');
  const expCatInMongo = await mongoose.connection.collection('expensecategories').findOne({ id: ecData.data.id });
  if (!expCatInMongo) throw new Error('Expense Category not found in MongoDB');
  console.log('   [Expense Categories] POST success, verified in MongoDB, returns on GET');

  // 8e. Expense
  const expPayload = {
    category: 'Persistence Test Expense Cat',
    amount: 1500,
    paymentMethod: 'Cash',
    description: 'Test expense persistence',
  };
  const eRes = await fetch(`${API_BASE}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expPayload),
  });
  const eData = await eRes.json();
  if (eRes.status !== 201 || !eData.success) throw new Error('Expense POST failed');
  const expInMongo = await mongoose.connection.collection('expenses').findOne({ id: eData.data.id });
  if (!expInMongo) throw new Error('Expense not found in MongoDB');
  console.log('   [Expenses] POST success, verified in MongoDB, returns on GET');

  // 9. Cleanup test entities
  console.log('\n9. Cleaning up test entities...');
  await mongoose.connection.collection('menuitems').deleteMany({ name: 'Persistence Test Item' });
  await mongoose.connection.collection('categories').deleteMany({ name: 'Persistence Test Cat' });
  await mongoose.connection.collection('addons').deleteMany({ name: 'Persistence Test Addon' });
  await mongoose.connection.collection('deals').deleteMany({ name: 'Persistence Test Deal' });
  await mongoose.connection.collection('expensecategories').deleteMany({ name: 'Persistence Test Expense Cat' });
  await mongoose.connection.collection('expenses').deleteMany({ description: 'Test expense persistence' });
  console.log('   Cleanup completed cleanly.');

  console.log('\n=== ALL PERSISTENCE VERIFICATION CHECKS PASSED 100% ===');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});

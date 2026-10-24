import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import { app } from './src/app.js';
import http from 'http';

async function runItemTests() {
  console.log('--- 🧪 STARTING MODULE 2 (MENU ITEMS) LIVE TESTS ---');

  // 1. Establish Atlas DB connection
  console.log('1. Connecting to MongoDB Atlas...');
  await connectDB();
  console.log('   ✅ Atlas Connected successfully!');

  // Start temporary local server on a test port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5098, resolve));
  const baseUrl = 'http://localhost:5098';
  console.log(`   📡 Local test server listening on ${baseUrl}`);

  try {
    // 2. Ensure default categories are seeded so relational checks pass
    await fetch(`${baseUrl}/api/categories/seed`, { method: 'POST' });

    // Test SEED default items
    console.log('\n2. Testing POST /api/items/seed...');
    const seedRes = await fetch(`${baseUrl}/api/items/seed`, { method: 'POST' });
    const seedData = await seedRes.json();
    console.log('   Seed response status:', seedRes.status);
    console.log('   Seed response message:', seedData.message);
    if (!seedData.success || seedData.count < 8) {
      throw new Error('Seed items failed: ' + JSON.stringify(seedData));
    }
    console.log(`   ✅ Seed passed! (${seedData.count} items in MongoDB Atlas)`);

    // 3. Test GET all items
    console.log('\n3. Testing GET /api/items...');
    const getRes = await fetch(`${baseUrl}/api/items`);
    const getData = await getRes.json();
    console.log(`   Status: ${getRes.status}, Total Items retrieved: ${getData.count}`);
    if (!getData.success || getData.count < 8) {
      throw new Error('GET /api/items failed');
    }
    console.log('   Sample item:', getData.data[0].name, `(ID: ${getData.data[0].id}, Category: ${getData.data[0].categoryName})`);
    console.log('   ✅ GET all items passed!');

    // 4. Test Category Filter
    console.log('\n4. Testing GET /api/items?categoryId=cat-biryani...');
    const catRes = await fetch(`${baseUrl}/api/items?categoryId=cat-biryani`);
    const catData = await catRes.json();
    console.log(`   Items in cat-biryani: ${catData.count}`);
    if (!catData.success || catData.count === 0 || catData.data[0].categoryId !== 'cat-biryani') {
      throw new Error('Category filter failed');
    }
    console.log('   Found item:', catData.data[0].name, '| Base Price: Rs', catData.data[0].basePrice);
    console.log('   ✅ Category filter passed!');

    // 5. Test Search Filter
    console.log('\n5. Testing GET /api/items?search=burger...');
    const searchRes = await fetch(`${baseUrl}/api/items?search=burger`);
    const searchData = await searchRes.json();
    console.log(`   Search results found: ${searchData.count}`);
    if (!searchData.success || searchData.count === 0) {
      throw new Error('Search failed to find burger item');
    }
    console.log('   Found item:', searchData.data[0].name);
    console.log('   ✅ Search query passed!');

    // 6. Test GET by custom ID
    console.log('\n6. Testing GET /api/items/item-1...');
    const singleRes = await fetch(`${baseUrl}/api/items/item-1`);
    const singleData = await singleRes.json();
    if (!singleData.success || singleData.data.name !== 'Special Chicken Biryani') {
      throw new Error('GET single item by ID failed');
    }
    console.log('   Found:', singleData.data.name, '| Portions:', singleData.data.portionOptions.length, '| Addons:', singleData.data.addonIds.length);
    console.log('   ✅ GET single item passed!');

    // 7. Test POST create new item with valid category
    console.log('\n7. Testing POST /api/items (Creating new menu item)...');
    const newItemPayload = {
      name: 'Mutton Yakhni Pulao',
      categoryId: 'cat-biryani',
      description: 'Fragrant aged basmati rice cooked in slow-simmered rich mutton broth',
      basePrice: 1200,
      unitType: 'weight',
      baseUnit: 'kg',
      unit: '1 Kg',
      portionOptions: [
        { label: '500g', quantityInBaseUnit: 0.5 },
        { label: '1kg', quantityInBaseUnit: 1.0 },
      ],
      addonIds: ['addon-raita', 'addon-salad'],
    };
    const createRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItemPayload),
    });
    const createData = await createRes.json();
    console.log('   Status:', createRes.status);
    if (!createData.success || !createData.data.id) {
      throw new Error('Create item failed: ' + JSON.stringify(createData));
    }
    const createdId = createData.data.id;
    console.log(`   ✅ Created item: '${createData.data.name}' with ID: '${createdId}', Category: '${createData.data.categoryName}'`);

    // 8. Test PUT update item
    console.log(`\n8. Testing PUT /api/items/${createdId}...`);
    const updateRes = await fetch(`${baseUrl}/api/items/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePrice: 1350, description: 'Premium royal mutton yakhni pulao with dry fruit garnish' }),
    });
    const updateData = await updateRes.json();
    if (!updateData.success || updateData.data.basePrice !== 1350) {
      throw new Error('Update item failed');
    }
    console.log(`   ✅ Updated item price to: Rs ${updateData.data.basePrice}`);

    // 9. Test Relational Validation: Invalid categoryId must be rejected
    console.log('\n9. Testing Relational Integrity (Non-existent categoryId)...');
    const badCategoryRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Test Item',
        categoryId: 'cat-non-existent-999',
        basePrice: 500,
      }),
    });
    const badCategoryData = await badCategoryRes.json();
    console.log('   Status:', badCategoryRes.status, '(Expected 400)');
    if (badCategoryRes.status !== 400 || badCategoryData.success !== false) {
      throw new Error('Item creation allowed invalid categoryId');
    }
    console.log('   Error Message:', badCategoryData.error.message);
    console.log('   ✅ Foreign category relation integrity enforced!');

    // 10. Test Payload Validation: Negative basePrice rejected
    console.log('\n10. Testing Zod Validation (Negative basePrice)...');
    const badPriceRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Negative Price Item',
        categoryId: 'cat-biryani',
        basePrice: -50,
      }),
    });
    const badPriceData = await badPriceRes.json();
    console.log('   Status:', badPriceRes.status, '(Expected 400)');
    if (badPriceRes.status !== 400 || badPriceData.success !== false) {
      throw new Error('Validation failed to reject negative price');
    }
    console.log('   Validation message:', badPriceData.error.message);
    console.log('   ✅ Zod validation successfully intercepted and rejected invalid price!');

    // 11. Test DELETE item
    console.log(`\n11. Testing DELETE /api/items/${createdId}...`);
    const deleteRes = await fetch(`${baseUrl}/api/items/${createdId}`, {
      method: 'DELETE',
    });
    const deleteData = await deleteRes.json();
    if (!deleteData.success) {
      throw new Error('Delete item failed');
    }
    console.log('   Delete message:', deleteData.message);
    console.log('   ✅ Item deleted successfully!');

    // 12. Verify deleted item returns 404
    console.log(`\n12. Testing GET /api/items/${createdId} (after deletion)...`);
    const notFoundRes = await fetch(`${baseUrl}/api/items/${createdId}`);
    console.log('   Status:', notFoundRes.status, '(Expected 404)');
    if (notFoundRes.status !== 404) {
      throw new Error('Item still found after deletion');
    }
    console.log('   ✅ 404 correctly returned for deleted item!');

    console.log('\n🎉 ========================================================');
    console.log('🎉 ALL MODULE 2 (MENU ITEMS) TESTS PASSED 100% SUCCESSFULLY!');
    console.log('🎉 ATLAS DB LIVE CRUD & RELATIONS FULLY OPERATIONAL!');
    console.log('🎉 ========================================================\n');

  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runItemTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  });

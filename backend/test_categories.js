import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import { Category } from './src/models/Category.js';
import { app } from './src/app.js';
import http from 'http';

async function runTests() {
  console.log('--- 🧪 STARTING MODULE 1 (CATEGORIES) LIVE TESTS ---');
  
  // 1. Establish Atlas DB connection
  console.log('1. Connecting to MongoDB Atlas...');
  await connectDB();
  console.log('   ✅ Atlas Connected successfully!');

  // Start temporary local server on a test port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5099, resolve));
  const baseUrl = 'http://localhost:5099';
  console.log(`   📡 Local test server listening on ${baseUrl}`);

  try {
    // 0. Clean slate for testing (only test categories)
    await Category.deleteMany({
      name: {
        $in: [
          'Rice / Biryani',
          'Burgers & Sandwiches',
          'Karahi & Handi',
          'Artisan Pizza',
          'BBQ Specials',
          'Drinks & Beverages',
          'Soft Drink',
          'Z-NoOrder Cat',
          'A-NoOrder Cat',
          'BBQ',
        ],
      },
    });
    console.log('   🧹 Test DB initialized clean');

    // 2. Test SEED default categories
    console.log('\n2. Testing POST /api/categories/seed...');
    const seedRes = await fetch(`${baseUrl}/api/categories/seed`, { method: 'POST' });
    const seedData = await seedRes.json();
    console.log('   Seed response status:', seedRes.status);
    console.log('   Seed response message:', seedData.message);
    if (!seedData.success || seedData.count < 6) {
      throw new Error('Seed categories failed: ' + JSON.stringify(seedData));
    }
    console.log(`   ✅ Seed passed! (${seedData.count} categories in MongoDB Atlas)`);

    // 3. Test GET all categories and verify ascending sortOrder
    console.log('\n3. Testing GET /api/categories (default seeded ordering)...');
    const getRes = await fetch(`${baseUrl}/api/categories`);
    const getData = await getRes.json();
    console.log(`   Status: ${getRes.status}, Total Categories retrieved: ${getData.count}`);
    if (!getData.success || getData.count < 6) {
      throw new Error('GET /api/categories failed');
    }
    console.log('   Seeded category order:', getData.data.map((c) => `${c.name} (${c.sortOrder})`).join(', '));
    console.log('   ✅ GET all categories passed!');

    // 4. Test Search filter
    console.log('\n4. Testing GET /api/categories?search=biryani...');
    const searchRes = await fetch(`${baseUrl}/api/categories?search=biryani`);
    const searchData = await searchRes.json();
    console.log(`   Search results found: ${searchData.count}`);
    if (!searchData.success || searchData.count === 0) {
      throw new Error('Search failed to find biryani category');
    }
    console.log('   Found category:', searchData.data[0].name);
    console.log('   ✅ Search query passed!');

    // 5. Test GET by custom ID
    console.log('\n5. Testing GET /api/categories/cat-biryani...');
    const singleRes = await fetch(`${baseUrl}/api/categories/cat-biryani`);
    const singleData = await singleRes.json();
    if (!singleData.success || singleData.data.slug !== 'rice-biryani') {
      throw new Error('GET single category by ID failed');
    }
    console.log('   Found:', singleData.data.name, '| Portions:', singleData.data.defaultPortions.length);
    console.log('   ✅ GET single category passed!');

    // Clean out seed data to test specific sortOrder cases
    await Category.deleteMany({
      name: {
        $in: [
          'Rice / Biryani',
          'Burgers & Sandwiches',
          'Karahi & Handi',
          'Artisan Pizza',
          'BBQ Specials',
          'Drinks & Beverages',
        ],
      },
    });

    // 6. Test Specific sortOrder Scenarios (Test Rice = 1, Test Roll = 2, Test Soft Drink = 3, Missing sortOrder, Duplicate sortOrder)
    console.log('\n6. Testing Custom Category sortOrder insertion & sorting...');
    const testCats = [
      { name: 'Test Soft Drink', sortOrder: 3, status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['drink'] },
      { name: 'Test Rice', sortOrder: 1, status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['rice'] },
      { name: 'Test Roll', sortOrder: 2, status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['roll'] },
      { name: 'Test Z-NoOrder Cat', status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['extra'] },
      { name: 'Test A-NoOrder Cat', status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['extra'] },
      { name: 'Test BBQ', sortOrder: 2, status: 'active', defaultUnitType: 'piece', baseUnit: 'piece', keywords: ['bbq'] }, // Duplicate sortOrder = 2
    ];

    for (const cat of testCats) {
      const res = await fetch(`${baseUrl}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cat),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(`Failed to create category ${cat.name}: ` + JSON.stringify(data));
      }
    }

    const sortRes = await fetch(`${baseUrl}/api/categories`);
    const sortData = await sortRes.json();
    const testOnlyCategories = sortData.data.filter((c) => c.name.startsWith('Test '));
    const orderedNames = testOnlyCategories.map((c) => c.name);
    console.log('   Returned order:', orderedNames.join(' | '));

    // Expected tier-based order for Test categories:
    // Food first: Test Rice (1), Test BBQ (2), Test Roll (2), Test A-NoOrder Cat, Test Z-NoOrder Cat
    // Drink last: Test Soft Drink (3)
    const expected = ['Test Rice', 'Test BBQ', 'Test Roll', 'Test A-NoOrder Cat', 'Test Z-NoOrder Cat', 'Test Soft Drink'];
    for (let i = 0; i < expected.length; i++) {
      if (orderedNames[i] !== expected[i]) {
        throw new Error(`Order mismatch at index ${i}: expected "${expected[i]}", got "${orderedNames[i]}"`);
      }
    }
    console.log('   ✅ Tier-based sortOrder, tie-breaker, and drink-at-end ordering verified!');

    // 7. Test invalid sortOrder validation
    console.log('\n7. Testing validation rejection on invalid sortOrder...');
    const invalidPayloads = [
      { name: 'Invalid 1', sortOrder: 0 },
      { name: 'Invalid 2', sortOrder: -5 },
      { name: 'Invalid 3', sortOrder: 2.5 },
    ];
    for (const payload of invalidPayloads) {
      const invRes = await fetch(`${baseUrl}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const invData = await invRes.json();
      if (invRes.status !== 400 || invData.success !== false) {
        throw new Error(`Invalid sortOrder ${payload.sortOrder} was not rejected! Status: ${invRes.status}`);
      }
    }
    console.log('   ✅ Invalid sortOrder values (0, negative, float) correctly rejected with 400!');

    // 8. Test PUT update sortOrder
    console.log('\n8. Testing PUT update category sortOrder...');
    const testRice = sortData.data.find((c) => c.name === 'Test Rice');
    const updateRes = await fetch(`${baseUrl}/api/categories/${testRice.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: 10 }),
    });
    const updateData = await updateRes.json();
    if (!updateData.success || updateData.data.sortOrder !== 10) {
      throw new Error('Update sortOrder failed');
    }
    console.log(`   ✅ Updated '${testRice.name}' sortOrder to ${updateData.data.sortOrder}`);

    // Verify re-sorted order
    const afterUpdateRes = await fetch(`${baseUrl}/api/categories`);
    const afterUpdateData = await afterUpdateRes.json();
    const testAfter = afterUpdateData.data.filter((c) => c.name.startsWith('Test '));
    const newFirst = testAfter[0].name;
    if (newFirst !== 'Test BBQ') {
      throw new Error(`Expected first test category after Test Rice sortOrder update to be 'Test BBQ', got '${newFirst}'`);
    }
    console.log(`   ✅ Category order dynamically updated in API response! First is now '${newFirst}'`);

    console.log('\n🎉 ========================================================');
    console.log('🎉 ALL CATEGORY SORT ORDER & API TESTS PASSED 100%!');
    console.log('🎉 ========================================================\n');

    const testCatNames = [
      'Rice / Biryani',
      'Burgers & Sandwiches',
      'Karahi & Handi',
      'Artisan Pizza',
      'BBQ Specials',
      'Drinks & Beverages',
      'Test Soft Drink',
      'Test Rice',
      'Test Roll',
      'Test Z-NoOrder Cat',
      'Test A-NoOrder Cat',
      'Test BBQ',
    ];

  } finally {
    try {
      // Only clean up test-created categories, never wipe canonical categories
      const testNames = [
        'Test Soft Drink',
        'Test Rice',
        'Test Roll',
        'Test Z-NoOrder Cat',
        'Test A-NoOrder Cat',
        'Test BBQ',
      ];
      await Category.deleteMany({ name: { $in: testNames } });
      console.log('   🧹 Test-specific categories cleaned up from Atlas.');
    } catch (e) {
      console.warn('   Cleanup warning:', e.message);
    }
    server.close();
    await mongoose.disconnect();
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  });

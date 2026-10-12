// test-ads.js
const adsService = require('./services/ads-service');

async function test() {
  await adsService.init();

  console.log('\n--- 1. TEKİL DEĞER OKUMA (readValue) ---');
  try {
    const val = await adsService.client.readValue('GVL_HMI.stRecipes.rSpeedSet');
    console.log('✅ rSpeedSet Değeri:', val);
  } catch (e) {
    console.log('❌ rSpeedSet okunamadı:', e.message);
  }

  console.log('\n--- 2. STRING DEĞER OKUMA (sRecipeName) ---');
  try {
    const nameVal = await adsService.client.readValue('GVL_HMI.stRecipes.sRecipeName');
    console.log('✅ sRecipeName Değeri:', nameVal);
  } catch (e) {
    console.log('❌ sRecipeName okunamadı:', e.message);
  }

  console.log('\n--- 3. SAFE READ WRAPPER TESTİ ---');
  try {
    const safeVal = await adsService.safeRead('GVL_HMI.stRecipes.rSpeedSet');
    console.log('✅ safeRead Değeri:', safeVal);
  } catch (e) {
    console.log('❌ safeRead okunamadı:', e.message);
  }

  process.exit(0);
}

test();
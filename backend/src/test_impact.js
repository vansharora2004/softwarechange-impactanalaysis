import { analyzeImpact } from './services/impactEngine.js';

async function runTest() {
  console.log('🧪 Starting Test for Change Impact Engine...');
  
  // Test case: select "ClinicService" as changed component
  const changedComponents = ['ClinicService'];
  console.log(`🔍 Selecting Changed Component: ${changedComponents.join(', ')}`);

  try {
    const report = await analyzeImpact(changedComponents);
    console.log(`📊 Potentially Impacted Components Found: ${report.length}`);
    
    // Print all impact results
    report.forEach((item, index) => {
      console.log(`\n[${index + 1}] ${item.name} (${item.type})`);
      console.log(`    Impact level: ${item.impactLevel}`);
      console.log(`    Reason: ${item.reason}`);
      console.log(`    Path: ${item.reasoningPath}`);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

runTest();

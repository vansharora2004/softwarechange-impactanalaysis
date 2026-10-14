import path from 'path';
import fs from 'fs';
import { analyzeRepository } from './analyzers/javaAnalyzer.js';

const defaultRepoPath = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const repoPath = process.argv[2] || defaultRepoPath;

console.log(`🚀 Starting analysis of repository: ${repoPath}`);
const start = Date.now();

try {
  const result = analyzeRepository(repoPath);
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  
  console.log(`\n✅ Analysis completed in ${duration}s`);
  console.log(`📦 Extracted Components: ${result.components.length}`);
  console.log(`🔗 Extracted Relationships: ${result.relationships.length}`);

  // Component breakdown
  const typeCounts = {};
  result.components.forEach(c => {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
  });
  console.log('\n📊 Component Breakdown:');
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(` - ${type}: ${count}`);
  });

  // Relationship breakdown by type
  const relCounts = {};
  result.relationships.forEach(r => {
    relCounts[r.type] = (relCounts[r.type] || 0) + 1;
  });
  console.log('\n🔗 Relationship Breakdown by Type:');
  Object.entries(relCounts).forEach(([type, count]) => {
    console.log(` - ${type}: ${count}`);
  });

  const outputFilePath = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(import.meta.dirname || '.', '../analysis_output.json');
  fs.writeFileSync(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n📄 Saved intermediate JSON output to: ${outputFilePath}`);

} catch (error) {
  console.error('❌ Analysis failed:', error);
  process.exit(1);
}

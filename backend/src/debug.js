import fs from 'fs';
import path from 'path';

const dataPath = path.join(import.meta.dirname || '.', '../analysis_output.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

console.log('OwnerRepository component:', data.components.find(c => c.name === 'OwnerRepository'));
console.log('ClinicService component:', data.components.find(c => c.name === 'ClinicService'));
console.log('OwnerRestControllerV1 component:', data.components.find(c => c.name === 'OwnerRestControllerV1'));

// Print all components that are of type Repository
console.log('Repositories:', data.components.filter(c => c.type === 'Repository').map(c => c.name));

import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'password';

let driver;

export function getDriver() {
  if (!driver) {
    driver = neo4j.driver(
      uri, 
      neo4j.auth.basic(user, password),
      { encrypted: 'ENCRYPTION_OFF' }
    );
  }
  return driver;
}

export async function verifyConnection() {
  const d = getDriver();
  try {
    const session = d.session();
    await session.run('RETURN 1');
    await session.close();
    return true;
  } catch (error) {
    console.error('⚠️ Neo4j Connection Error:', error.message);
    return false;
  }
}

export async function clearGraph(project) {
  const d = getDriver();
  const session = d.session();
  try {
    console.log(`🧹 Clearing previous components and relationships for project: ${project}`);
    await session.executeWrite(tx =>
      tx.run(
        'MATCH (c:Component {project: $project}) DETACH DELETE c',
        { project }
      )
    );
  } finally {
    await session.close();
  }
}

export async function storeGraph(analysisResult, project) {
  const d = getDriver();
  const session = d.session();
  try {
    console.log(`💾 Storing components and relationships in Neo4j for project: ${project}`);
    
    const { components, relationships } = analysisResult;

    // 1. Create component nodes — id is FQN, name is simple class name for display
    await session.executeWrite(tx =>
      tx.run(
        `
        UNWIND $components AS comp
        MERGE (c:Component {id: comp.id, project: $project})
        ON CREATE SET c.name = comp.name, c.type = comp.type, c.filePath = comp.filePath
        ON MATCH  SET c.name = comp.name, c.type = comp.type, c.filePath = comp.filePath
        `,
        { components, project }
      )
    );

    // Store relationships grouped by their specific types
    const relTypes = ['USES', 'TESTS', 'DEPENDS_ON', 'EXTENDS', 'ASSOCIATED_WITH', 'REFERENCES'];
    for (const type of relTypes) {
      const filteredRels = relationships.filter(r => r.type === type);
      if (filteredRels.length > 0) {
        await session.executeWrite(tx =>
          tx.run(
            `
            UNWIND $filteredRels AS rel
            MATCH (a:Component {id: rel.source, project: $project})
            MATCH (b:Component {id: rel.target, project: $project})
            MERGE (a)-[r:${type}]->(b)
            ON CREATE SET r.detail = rel.detail
            ON MATCH  SET r.detail = rel.detail
            `,
            { filteredRels, project }
          )
        );
      }
    }

    console.log('Graph stored successfully in Neo4j.');
  } finally {
    await session.close();
  }
}

export async function getAllComponents(project) {
  const d = getDriver();
  const session = d.session();
  try {
    const cypher = project
      ? 'MATCH (c:Component {project: $project}) RETURN c.id AS id, c.name AS name, c.type AS type, c.filePath AS filePath'
      : 'MATCH (c:Component) RETURN c.id AS id, c.name AS name, c.type AS type, c.filePath AS filePath';
    const result = await session.executeRead(tx => tx.run(cypher, { project }));
    return result.records.map(record => ({
      id: record.get('id'),
      name: record.get('name') || record.get('id'),
      type: record.get('type') || 'Other',
      filePath: record.get('filePath') || ''
    }));
  } finally {
    await session.close();
  }
}

export async function getAllRelationships(project) {
  const d = getDriver();
  const session = d.session();
  try {
    const cypher = project
      ? `
        MATCH (a:Component {project: $project})-[r]->(b:Component {project: $project})
        RETURN a.id AS source, b.id AS target, type(r) AS type, r.detail AS detail, r.count AS count
        `
      : `
        MATCH (a:Component)-[r]->(b:Component)
        RETURN a.id AS source, b.id AS target, type(r) AS type, r.detail AS detail, r.count AS count
        `;
    const result = await session.executeRead(tx => tx.run(cypher, { project }));
    return result.records.map(record => {
      const type = record.get('type');
      const detail = record.get('detail');
      const count = record.get('count');
      
      let formattedDetail = detail;
      if (!formattedDetail && count !== null && count !== undefined) {
        const countVal = typeof count.toNumber === 'function' ? count.toNumber() : count;
        formattedDetail = `Count: ${countVal}`;
      }

      return {
        source: record.get('source'),
        target: record.get('target'),
        type: type,
        detail: formattedDetail || ''
      };
    });
  } finally {
    await session.close();
  }
}

export async function getComponentsByProject(project) {
  const d = getDriver();
  const session = d.session();
  try {
    const result = await session.executeRead(tx =>
      tx.run(
        'MATCH (c:Component {project: $project}) RETURN c.id AS id, c.filePath AS filePath, c.name AS name',
        { project }
      )
    );
    return result.records.map(record => ({
      id: record.get('id'),
      filePath: record.get('filePath'),
      name: record.get('name')
    }));
  } finally {
    await session.close();
  }
}

export async function storeHistoricalRelationships(project, coChangePairs) {
  const d = getDriver();
  const session = d.session();
  try {
    // Clear existing historical relationships for idempotency
    await session.executeWrite(tx =>
      tx.run(
        'MATCH (a:Component {project: $project})-[r:CO_CHANGED_WITH]-(b:Component {project: $project}) DELETE r',
        { project }
      )
    );

    if (coChangePairs && coChangePairs.length > 0) {
      await session.executeWrite(tx =>
        tx.run(
          `
          UNWIND $coChangePairs AS pair
          MATCH (a:Component {id: pair.source, project: $project})
          MATCH (b:Component {id: pair.target, project: $project})
          MERGE (a)-[r:CO_CHANGED_WITH]->(b)
          SET r.count = pair.count
          `,
          { coChangePairs, project }
        )
      );
    }
    console.log(`Stored ${coChangePairs.length} historical relationships for project ${project}`);
  } finally {
    await session.close();
  }
}

export async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';
import { verifyConnection } from './services/neo4jService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Start Express server and check Neo4j status
app.listen(PORT, async () => {
  console.log(`Change Impact Framework Backend listening at: http://localhost:${PORT}`);
  
  const neo4jConnected = await verifyConnection();
  if (neo4jConnected) {
    console.log('Neo4j Database is ONLINE and ready.');
  } else {
    console.log('Neo4j Database is OFFLINE. The backend will use local In-Memory graph analysis fallbacks.');
  }
});

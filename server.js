// Local development server. On Vercel, public/ is served by the CDN and
// api/index.js handles the API instead.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './lib/app.js';
import { storeKind } from './lib/store.js';

const PORT = process.env.PORT || 3000;
const server = express();

server.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
server.use(app);

server.listen(PORT, () => {
  console.log(`London Venue RFP app on http://localhost:${PORT} (storage: ${storeKind})`);
});

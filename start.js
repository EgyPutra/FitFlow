import { createServer } from 'node:http';
import handler from './server.js';

const PORT = process.env.PORT || 3000;

createServer(handler).listen(PORT, () => {
  console.log(`\n  FitFlow running → http://localhost:${PORT}\n`);
});

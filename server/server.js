import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import authRouter from './auth.js';
import channelRouter from './channels.js';
import documentRouter from './documents.js';
import invitationRouter from './invitations.js';
import aiRouter from './routes/ai.routes.js';
import versionRouter from './versions.js';
import { setupSocketHandlers, flushAllDocumentContent } from './socketHandler.js';
import { ensureRichTextColumns, ensureAITables } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const httpServer = http.createServer(app);
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true }
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.redirect(process.env.CLIENT_URL || 'http://localhost:5173'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'collab-docs-server' }));
app.use('/api/auth', authRouter);
app.use('/api/channels', channelRouter);
app.use('/api/invitations', invitationRouter);
app.use('/api', documentRouter);
app.use('/api', versionRouter);
app.use('/api/ai', aiRouter);
setupSocketHandlers(io);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong' });
});

const port = Number(process.env.PORT) || 5000;
ensureRichTextColumns()
  .then(() => ensureAITables())
  .then(() => {
    httpServer.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Unable to prepare rich-text database columns', error);
    process.exitCode = 1;
  });

async function shutdown(signal) {
  const flushed = flushAllDocumentContent().catch((error) => {
    console.error('Failed to flush documents before shutdown', error);
  });
  await Promise.race([flushed, new Promise((resolve) => setTimeout(resolve, 1500))]);
  console.log(`Received ${signal}, server closed`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, io, httpServer };

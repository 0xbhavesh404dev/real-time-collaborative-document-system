import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import authRouter from './auth.js';
import channelRouter from './channels.js';
import documentRouter from './documents.js';
import versionRouter from './versions.js';
import { setupSocketHandlers } from './socketHandler.js';
import { ensureRichTextColumns } from './db.js';

dotenv.config({ path: '../.env' });

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
app.use('/api', documentRouter);
app.use('/api', versionRouter);
setupSocketHandlers(io);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong' });
});

const port = Number(process.env.PORT) || 5000;
ensureRichTextColumns()
  .then(() => {
    httpServer.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Unable to prepare rich-text database columns', error);
    process.exitCode = 1;
  });

export { app, io, httpServer };

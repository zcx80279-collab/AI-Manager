import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  executeAntigravityConnector,
  probeAntigravityConnector,
} from './server/adapters/antigravityAdapter.ts';
import {
  executeCodexConnector,
  probeCodexConnector,
} from './server/adapters/codexAdapter.ts';
import {
  executeGeminiConnector,
  probeGeminiConnector,
} from './server/adapters/geminiAdapter.ts';
import {
  executeGptConnector,
  probeGptConnector,
} from './server/adapters/gptAdapter.ts';
import {
  safeServerLog,
  sanitizeUserError,
} from './server/security/errorSanitizer.ts';
import {
  createNetworkSecurityGuard,
  getDefaultNetworkSecurityConfig,
} from './server/security/networkSecurity.ts';
import {
  ALLOWED_SERVICES,
  validateExecuteConnectorRequest,
  validateSharedControlStore,
} from './server/security/validators.ts';
import {
  clearLocalStore,
  readLocalStore,
  writeLocalStore,
} from './server/storage/localFileStore.ts';
import type {
  AIServiceId,
  RuntimeInfo,
} from './src/types/controlCenter.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);
  const netConfig = getDefaultNetworkSecurityConfig(port);
  const securityGuard = createNetworkSecurityGuard(netConfig);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/session', securityGuard.issueSessionHandler);
  app.use('/api', securityGuard.requireAuthenticatedApi);

  app.get('/api/runtime', (_req, res) => {
    const info: RuntimeInfo = {
      runtimeKind: 'web-preview',
      platform: process.platform,
      desktopBridgeAvailable: false,
      serverApiAvailable: true,
      appVersion: '0.1.0',
    };
    res.json(info);
  });

  app.get('/api/connectors/status', async (_req, res) => {
    try {
      const [gpt, gemini, codex, antigravity] = await Promise.all([
        probeGptConnector(),
        probeGeminiConnector(),
        probeCodexConnector(),
        probeAntigravityConnector(),
      ]);
      res.json({
        connectors: {
          gpt,
          gemini,
          codex,
          antigravity,
        },
        probedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      safeServerLog('connectors/status', err);
      res.status(500).json({
        errorCode: 'PROBE_FAILED',
        error: sanitizeUserError('커넥터 상태 점검에 실패했습니다.'),
      });
    }
  });

  app.post('/api/connectors/:id/execute', async (req, res) => {
    const serviceId = req.params.id as AIServiceId;
    if (!ALLOWED_SERVICES.has(serviceId)) {
      res.status(400).json({
        errorCode: 'INVALID_SERVICE',
        error: '허용되지 않은 AI 서비스 ID입니다.',
      });
      return;
    }

    const validated = validateExecuteConnectorRequest(req.body, serviceId);
    if (!validated.ok) {
      res.status(400).json({
        errorCode: 'INVALID_REQUEST',
        error: validated.errorMessage,
      });
      return;
    }

    try {
      let result;
      switch (serviceId) {
        case 'gpt':
          result = await executeGptConnector(validated.payload);
          break;
        case 'gemini':
          result = await executeGeminiConnector(validated.payload);
          break;
        case 'codex':
          result = await executeCodexConnector(validated.payload);
          break;
        case 'antigravity':
          result = await executeAntigravityConnector(validated.payload);
          break;
      }
      res.json(result);
    } catch (err: unknown) {
      safeServerLog(`connectors/${serviceId}/execute`, err);
      res.status(500).json({
        ok: false,
        serviceId,
        channelUsed: null,
        text: '',
        errorCode: 'EXECUTION_FAILED',
        errorMessage: sanitizeUserError('서버 실행 중 오류가 발생했습니다.'),
        executedAt: new Date().toISOString(),
      });
    }
  });

  app.get('/api/storage', async (_req, res) => {
    try {
      const store = await readLocalStore();
      res.json({ store });
    } catch (err: unknown) {
      safeServerLog('storage/read', err);
      res.status(500).json({
        errorCode: 'STORAGE_READ_FAILED',
        error: sanitizeUserError('공용 저장소 읽기에 실패했습니다.'),
      });
    }
  });

  app.post('/api/storage', async (req, res) => {
    const body = req.body as { store?: unknown } | undefined;
    const validated = validateSharedControlStore(body?.store);
    if (!validated.ok) {
      res.status(400).json({
        errorCode: 'INVALID_STORE',
        error: validated.errorMessage,
      });
      return;
    }

    try {
      const saved = await writeLocalStore(validated.store);
      res.json({ store: saved });
    } catch (err: unknown) {
      safeServerLog('storage/write', err);
      res.status(500).json({
        errorCode: 'STORAGE_WRITE_FAILED',
        error: sanitizeUserError('공용 저장소 저장에 실패했습니다.'),
      });
    }
  });

  app.delete('/api/storage', async (_req, res) => {
    try {
      await clearLocalStore();
      res.json({ ok: true });
    } catch (err: unknown) {
      safeServerLog('storage/clear', err);
      res.status(500).json({
        errorCode: 'STORAGE_CLEAR_FAILED',
        error: sanitizeUserError('공용 저장소 초기화에 실패했습니다.'),
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(netConfig.port, netConfig.bindHost, () => {
    console.log(
      `[AI-Control-Center] Server listening on http://${netConfig.bindHost}:${netConfig.port}`
    );
  });
}

startServer();

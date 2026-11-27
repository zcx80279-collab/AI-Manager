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
  clearLocalStore,
  readLocalStore,
  writeLocalStore,
} from './server/storage/localFileStore.ts';
import type {
  AIServiceId,
  ExecuteConnectorRequest,
  RuntimeInfo,
  SharedControlStore,
} from './src/types/controlCenter.ts';

const ALLOWED_SERVICES = new Set<AIServiceId>([
  'gpt',
  'gemini',
  'codex',
  'antigravity',
]);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);

  app.use(express.json({ limit: '2mb' }));

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
      res.status(500).json({
        error: err instanceof Error ? err.message : '커넥터 상태 점검 실패',
      });
    }
  });

  app.post('/api/connectors/:id/execute', async (req, res) => {
    const serviceId = req.params.id as AIServiceId;
    if (!ALLOWED_SERVICES.has(serviceId)) {
      res.status(400).json({ error: '허용되지 않은 AI 서비스 ID입니다.' });
      return;
    }

    const body = req.body as Partial<ExecuteConnectorRequest> | undefined;
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      res.status(400).json({ error: '유효한 명령(prompt)이 필요합니다.' });
      return;
    }

    if (body.prompt.length > 20000) {
      res.status(400).json({ error: '명령 길이가 허용 한도(20,000자)를 초과했습니다.' });
      return;
    }

    const payload: ExecuteConnectorRequest = {
      serviceId,
      prompt: body.prompt,
      systemInstruction:
        typeof body.systemInstruction === 'string' ? body.systemInstruction : undefined,
      userApprovedExecution: body.userApprovedExecution === true,
      contextMessages: Array.isArray(body.contextMessages)
        ? body.contextMessages
            .filter(
              (m): m is { from: string; content: string } =>
                Boolean(m) && typeof m.from === 'string' && typeof m.content === 'string'
            )
            .slice(-12)
        : undefined,
    };

    try {
      let result;
      switch (serviceId) {
        case 'gpt':
          result = await executeGptConnector(payload);
          break;
        case 'gemini':
          result = await executeGeminiConnector(payload);
          break;
        case 'codex':
          result = await executeCodexConnector(payload);
          break;
        case 'antigravity':
          result = await executeAntigravityConnector(payload);
          break;
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        serviceId,
        channelUsed: null,
        text: '',
        errorCode: 'EXECUTION_FAILED',
        errorMessage: err instanceof Error ? err.message : '알 수 없는 서버 실행 오류',
        executedAt: new Date().toISOString(),
      });
    }
  });

  app.get('/api/storage', async (_req, res) => {
    try {
      const store = await readLocalStore();
      res.json({ store });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '공용 저장소 읽기 실패',
      });
    }
  });

  app.post('/api/storage', async (req, res) => {
    const body = req.body as { store?: SharedControlStore } | undefined;
    const candidate = body?.store;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !Array.isArray(candidate.agents) ||
      !Array.isArray(candidate.commands) ||
      !Array.isArray(candidate.tasks) ||
      !Array.isArray(candidate.messages)
    ) {
      res.status(400).json({ error: '공용 저장소 데이터 구조가 올바르지 않습니다.' });
      return;
    }

    try {
      const saved = await writeLocalStore(candidate);
      res.json({ store: saved });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '공용 저장소 저장 실패',
      });
    }
  });

  app.delete('/api/storage', async (_req, res) => {
    try {
      await clearLocalStore();
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '공용 저장소 초기화 실패',
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

  app.listen(port, '0.0.0.0', () => {
    console.log(`[AI-Control-Center] Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();

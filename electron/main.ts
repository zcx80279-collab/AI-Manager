import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { createChatGPT } from '../vendor/siwc-local/src/index.ts';
import {
  executeAntigravityConnector,
  probeAntigravityConnector,
} from '../server/adapters/antigravityAdapter.ts';
import {
  executeCodexConnector,
  probeCodexConnector,
} from '../server/adapters/codexAdapter.ts';
import {
  executeGeminiConnector,
  probeGeminiConnector,
} from '../server/adapters/geminiAdapter.ts';
import {
  executeGptConnector,
  probeGptConnector,
  setGptClient,
  getGptSession,
  signInGpt,
  signOutGpt,
  resumeGptAfterLimit,
} from '../server/adapters/gptAdapter.ts';
import type {
  AIServiceId,
  ExecuteConnectorRequest,
  RuntimeInfo,
  SharedControlStore,
} from '../src/types/controlCenter.ts';

const ALLOWED_SERVICES = new Set<AIServiceId>([
  'gpt',
  'gemini',
  'codex',
  'antigravity',
]);

function initializeChatGPT() {
  setGptClient(createChatGPT({
    appName: 'AI-Manager',
    appId: 'ai-manager',
    redirectPort: 0,
    sendHostId: true,
    storageDir: path.join(app.getPath('userData'), 'chatgpt'),
    credentialEncryption: {
      id: 'electron-safe-storage-v1',
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 보안 저장소를 사용할 수 없습니다.');
        return safeStorage.encryptString(value);
      },
      decrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 보안 저장소를 사용할 수 없습니다.');
        return safeStorage.decryptString(Buffer.from(value));
      },
    },
    openBrowser: async (url) => {
      if (new URL(url).origin !== 'https://auth.openai.com') throw new Error('인증 주소가 올바르지 않습니다.');
      await shell.openExternal(url);
    },
  }), path.join(app.getPath('userData'), 'gpt-quota-state.json'));
}

function getDesktopStorePath(): string {
  return path.join(app.getPath('userData'), 'control-center-store.json');
}

function registerIpcHandlers() {
  ipcMain.handle('control-center:gpt-session', getGptSession);
  ipcMain.handle('control-center:gpt-sign-in', signInGpt);
  ipcMain.handle('control-center:gpt-sign-out', signOutGpt);
  ipcMain.handle('control-center:gpt-resume-after-limit', resumeGptAfterLimit);
  ipcMain.handle('control-center:get-runtime', (): RuntimeInfo => {
    return {
      runtimeKind: 'electron-desktop',
      platform: process.platform,
      desktopBridgeAvailable: true,
      serverApiAvailable: false,
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle('control-center:probe-connectors', async () => {
    const [gpt, gemini, codex, antigravity] = await Promise.all([
      probeGptConnector(),
      probeGeminiConnector(),
      probeCodexConnector(),
      probeAntigravityConnector(),
    ]);
    return {
      connectors: { gpt, gemini, codex, antigravity },
      probedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle(
    'control-center:execute-connector',
    async (_event, rawReq: unknown) => {
      const req = rawReq as Partial<ExecuteConnectorRequest> | undefined;
      if (!req || !req.serviceId || !ALLOWED_SERVICES.has(req.serviceId)) {
        return {
          ok: false,
          serviceId: 'gpt',
          channelUsed: null,
          text: '',
          errorCode: 'EXECUTION_FAILED',
          errorMessage: '허용되지 않은 서비스 ID입니다.',
          executedAt: new Date().toISOString(),
        };
      }
      if (typeof req.prompt !== 'string' || req.prompt.trim().length === 0) {
        return {
          ok: false,
          serviceId: req.serviceId,
          channelUsed: null,
          text: '',
          errorCode: 'EXECUTION_FAILED',
          errorMessage: '유효한 prompt가 필요합니다.',
          executedAt: new Date().toISOString(),
        };
      }

      const payload: ExecuteConnectorRequest = {
        serviceId: req.serviceId,
        prompt: req.prompt,
        systemInstruction:
          typeof req.systemInstruction === 'string' ? req.systemInstruction : undefined,
        userApprovedExecution: req.userApprovedExecution === true,
        contextMessages: Array.isArray(req.contextMessages)
          ? req.contextMessages.slice(-12)
          : undefined,
      };

      switch (payload.serviceId) {
        case 'gpt':
          return executeGptConnector(payload);
        case 'gemini':
          return executeGeminiConnector(payload);
        case 'codex':
          return executeCodexConnector(payload);
        case 'antigravity':
          return executeAntigravityConnector(payload);
      }
    }
  );

  ipcMain.handle('control-center:load-store', async () => {
    try {
      const raw = await fs.readFile(getDesktopStorePath(), 'utf-8');
      return { store: JSON.parse(raw) as SharedControlStore };
    } catch {
      return { store: null };
    }
  });

  ipcMain.handle(
    'control-center:save-store',
    async (_event, store: unknown) => {
      const candidate = store as SharedControlStore;
      const filePath = getDesktopStorePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const saved: SharedControlStore = {
        ...candidate,
        lastSavedAt: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(saved, null, 2), 'utf-8');
      return { store: saved };
    }
  );

  ipcMain.handle('control-center:clear-store', async () => {
    try {
      await fs.unlink(getDesktopStorePath());
    } catch {
      // Ignore missing file
    }
    return { ok: true };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

void app.whenReady().then(() => {
  initializeChatGPT();
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

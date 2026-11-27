import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
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
} from '../server/adapters/gptAdapter.ts';
import {
  safeServerLog,
  sanitizeUserError,
} from '../server/security/errorSanitizer.ts';
import {
  isAllowedElectronStartUrl,
  isAllowedIpcSender,
  validateExecuteConnectorRequest,
  validateSharedControlStore,
} from '../server/security/validators.ts';
import type {
  RuntimeInfo,
  SharedControlStore,
} from '../src/types/controlCenter.ts';

const DIST_INDEX_PATH = path.join(__dirname, '../dist/index.html');
const EXPECTED_FILE_URL = pathToFileURL(DIST_INDEX_PATH).href;

function resolveAllowedDevUrl(): { url: string; origin: string } | null {
  const raw = process.env.ELECTRON_START_URL?.trim();
  if (!raw) return null;
  if (!isAllowedElectronStartUrl(raw)) {
    safeServerLog('electron/start-url', 'Blocked disallowed ELECTRON_START_URL');
    return null;
  }
  const parsed = new URL(raw);
  return { url: parsed.href, origin: parsed.origin };
}

const ALLOWED_DEV_TARGET = resolveAllowedDevUrl();

function assertAuthorizedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (!isAllowedIpcSender(senderUrl, ALLOWED_DEV_TARGET?.origin ?? null, EXPECTED_FILE_URL)) {
    safeServerLog('electron/ipc-auth', 'Blocked unauthorized IPC sender frame');
    throw new Error('허용되지 않은 출처의 IPC 요청이 차단되었습니다.');
  }
}

function getDesktopStorePath(): string {
  return path.join(app.getPath('userData'), 'control-center-store.json');
}

function registerIpcHandlers() {
  ipcMain.handle('control-center:get-runtime', (event): RuntimeInfo => {
    assertAuthorizedIpcSender(event);
    return {
      runtimeKind: 'electron-desktop',
      platform: process.platform,
      desktopBridgeAvailable: true,
      serverApiAvailable: false,
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle('control-center:probe-connectors', async (event) => {
    assertAuthorizedIpcSender(event);
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
    async (event, rawReq: unknown) => {
      assertAuthorizedIpcSender(event);
      const validated = validateExecuteConnectorRequest(rawReq);
      if (!validated.ok) {
        return {
          ok: false,
          serviceId: 'gpt',
          channelUsed: null,
          text: '',
          errorCode: 'EXECUTION_FAILED',
          errorMessage: validated.errorMessage,
          executedAt: new Date().toISOString(),
        };
      }

      const payload = validated.payload;
      try {
        switch (payload.serviceId) {
          case 'gpt':
            return await executeGptConnector(payload);
          case 'gemini':
            return await executeGeminiConnector(payload);
          case 'codex':
            return await executeCodexConnector(payload);
          case 'antigravity':
            return await executeAntigravityConnector(payload);
        }
      } catch (err: unknown) {
        safeServerLog(`electron/execute/${payload.serviceId}`, err);
        return {
          ok: false,
          serviceId: payload.serviceId,
          channelUsed: null,
          text: '',
          errorCode: 'EXECUTION_FAILED',
          errorMessage: sanitizeUserError('커넥터 실행 중 오류가 발생했습니다.'),
          executedAt: new Date().toISOString(),
        };
      }
    }
  );

  ipcMain.handle('control-center:load-store', async (event) => {
    assertAuthorizedIpcSender(event);
    try {
      const raw = await fs.readFile(getDesktopStorePath(), 'utf-8');
      return { store: JSON.parse(raw) as SharedControlStore };
    } catch {
      return { store: null };
    }
  });

  ipcMain.handle(
    'control-center:save-store',
    async (event, store: unknown) => {
      assertAuthorizedIpcSender(event);
      const validated = validateSharedControlStore(store);
      if (!validated.ok) {
        throw new Error(validated.errorMessage);
      }
      const filePath = getDesktopStorePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const saved: SharedControlStore = {
        ...validated.store,
        lastSavedAt: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(saved, null, 2), 'utf-8');
      return { store: saved };
    }
  );

  ipcMain.handle('control-center:clear-store', async (event) => {
    assertAuthorizedIpcSender(event);
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedIpcSender(targetUrl, ALLOWED_DEV_TARGET?.origin ?? null, EXPECTED_FILE_URL)) {
      event.preventDefault();
      safeServerLog('electron/navigation', 'Blocked external navigation attempt');
    }
  });

  if (ALLOWED_DEV_TARGET) {
    void win.loadURL(ALLOWED_DEV_TARGET.url);
  } else {
    void win.loadFile(DIST_INDEX_PATH);
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

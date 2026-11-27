import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExecuteConnectorRequest,
  SharedControlStore,
} from '../src/types/controlCenter.ts';

// Strictly allowlisted IPC channels only
const ALLOWED_CHANNELS = new Set([
  'control-center:get-runtime',
  'control-center:probe-connectors',
  'control-center:execute-connector',
  'control-center:load-store',
  'control-center:save-store',
  'control-center:clear-store',
  'control-center:gpt-session',
  'control-center:gpt-sign-in',
  'control-center:gpt-sign-out',
  'control-center:gpt-resume-after-limit',
]);

function safeInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`허용되지 않은 IPC 채널입니다: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

contextBridge.exposeInMainWorld('desktopBridge', {
  getGptSession: () => safeInvoke('control-center:gpt-session'),
  signInGpt: () => safeInvoke('control-center:gpt-sign-in'),
  signOutGpt: () => safeInvoke('control-center:gpt-sign-out'),
  resumeGptAfterLimit: () => safeInvoke('control-center:gpt-resume-after-limit'),
  getRuntimeInfo: () => safeInvoke('control-center:get-runtime'),
  probeConnectors: () => safeInvoke('control-center:probe-connectors'),
  executeConnector: (request: ExecuteConnectorRequest) =>
    safeInvoke('control-center:execute-connector', request),
  loadStore: () => safeInvoke('control-center:load-store'),
  saveStore: (store: SharedControlStore) =>
    safeInvoke('control-center:save-store', store),
  clearStore: () => safeInvoke('control-center:clear-store'),
});

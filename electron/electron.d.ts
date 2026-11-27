// Minimal ambient Electron type declarations for type-checking electron/* without installing the full Electron binary in web preview.
// Remove this file if `electron` is installed in node_modules for desktop packaging.
declare module 'electron' {
  export interface IpcMainInvokeEvent {
    senderFrame?: { url: string };
  }

  export const app: {
    whenReady: () => Promise<void>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    quit: () => void;
    getPath: (name: string) => string;
    getVersion: () => string;
  };

  export interface WebContents {
    setWindowOpenHandler: (
      handler: (details: { url: string }) => { action: 'allow' | 'deny' }
    ) => void;
    on: (
      event: 'will-navigate',
      listener: (event: { preventDefault: () => void }, url: string) => void
    ) => void;
  }

  export class BrowserWindow {
    constructor(options: Record<string, unknown>);
    webContents: WebContents;
    loadURL: (url: string) => Promise<void>;
    loadFile: (filePath: string) => Promise<void>;
    static getAllWindows: () => BrowserWindow[];
  }

  export const ipcMain: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown
    ) => void;
  };

  export const contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };

  export const ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}

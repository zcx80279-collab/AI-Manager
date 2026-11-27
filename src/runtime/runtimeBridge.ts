import type {
  AIServiceId,
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
  RuntimeInfo,
  SharedControlStore,
} from '../types/controlCenter.ts';

export interface DesktopBridgeAPI {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  probeConnectors: () => Promise<{
    connectors: Record<AIServiceId, ConnectorProbeResult>;
    probedAt: string;
  }>;
  executeConnector: (
    request: ExecuteConnectorRequest
  ) => Promise<ExecuteConnectorResponse>;
  loadStore: () => Promise<{ store: SharedControlStore | null }>;
  saveStore: (store: SharedControlStore) => Promise<{ store: SharedControlStore }>;
  clearStore: () => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridgeAPI;
  }
}

export interface RuntimeBridge {
  isDesktop: () => boolean;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  probeConnectors: () => Promise<{
    connectors: Record<AIServiceId, ConnectorProbeResult>;
    probedAt: string;
  }>;
  executeConnector: (
    request: ExecuteConnectorRequest,
    signal?: AbortSignal
  ) => Promise<ExecuteConnectorResponse>;
  loadStore: () => Promise<SharedControlStore | null>;
  saveStore: (store: SharedControlStore) => Promise<SharedControlStore>;
  clearStore: () => Promise<void>;
}

export const defaultRuntimeBridge: RuntimeBridge = {
  isDesktop() {
    return typeof window !== 'undefined' && Boolean(window.desktopBridge);
  },

  async getRuntimeInfo() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      return window.desktopBridge.getRuntimeInfo();
    }
    const res = await fetch('/api/runtime');
    if (!res.ok) {
      throw new Error(`런타임 정보 조회 실패 (${res.status})`);
    }
    return (await res.json()) as RuntimeInfo;
  },

  async probeConnectors() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      return window.desktopBridge.probeConnectors();
    }
    const res = await fetch('/api/connectors/status');
    if (!res.ok) {
      throw new Error(`커넥터 상태 점검 실패 (${res.status})`);
    }
    return (await res.json()) as {
      connectors: Record<AIServiceId, ConnectorProbeResult>;
      probedAt: string;
    };
  },

  async executeConnector(request, signal) {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      if (signal?.aborted) {
        return {
          ok: false,
          serviceId: request.serviceId,
          channelUsed: null,
          text: '',
          errorCode: 'ABORTED',
          errorMessage: '사용자에 의해 작업이 중지되었습니다.',
          executedAt: new Date().toISOString(),
        };
      }
      return window.desktopBridge.executeConnector(request);
    }

    const res = await fetch(`/api/connectors/${request.serviceId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        serviceId: request.serviceId,
        channelUsed: null,
        text: '',
        errorCode: 'EXECUTION_FAILED',
        errorMessage: `HTTP ${res.status}: ${text}`,
        executedAt: new Date().toISOString(),
      };
    }
    return (await res.json()) as ExecuteConnectorResponse;
  },

  async loadStore() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      const result = await window.desktopBridge.loadStore();
      return result.store;
    }
    const res = await fetch('/api/storage');
    if (!res.ok) {
      throw new Error(`공용 저장소 로드 실패 (${res.status})`);
    }
    const data = (await res.json()) as { store: SharedControlStore | null };
    return data.store;
  },

  async saveStore(store) {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      const result = await window.desktopBridge.saveStore(store);
      return result.store;
    }
    const res = await fetch('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store }),
    });
    if (!res.ok) {
      throw new Error(`공용 저장소 저장 실패 (${res.status})`);
    }
    const data = (await res.json()) as { store: SharedControlStore };
    return data.store;
  },

  async clearStore() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      await window.desktopBridge.clearStore();
      return;
    }
    const res = await fetch('/api/storage', { method: 'DELETE' });
    if (!res.ok) {
      throw new Error(`공용 저장소 초기화 실패 (${res.status})`);
    }
  },
};

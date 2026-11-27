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

let cachedCsrfToken: string | null = null;

async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (cachedCsrfToken && !forceRefresh) {
    return cachedCsrfToken;
  }
  const res = await fetch('/api/session', {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`세션 인증 초기화 실패 (${res.status})`);
  }
  const data = (await res.json()) as { csrfToken?: string };
  if (!data.csrfToken) {
    throw new Error('유효한 세션 토큰을 수신하지 못했습니다.');
  }
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken;
}

async function authenticatedApiFetch(
  url: string,
  init: RequestInit = {},
  retryOnUnauthorized = true
): Promise<Response> {
  const token = await ensureCsrfToken();
  const headers = new Headers(init.headers);
  headers.set('X-AI-Manager-CSRF', token);

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 401 && retryOnUnauthorized) {
    await ensureCsrfToken(true);
    return authenticatedApiFetch(url, init, false);
  }
  return res;
}

export const defaultRuntimeBridge: RuntimeBridge = {
  isDesktop() {
    return typeof window !== 'undefined' && Boolean(window.desktopBridge);
  },

  async getRuntimeInfo() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      return window.desktopBridge.getRuntimeInfo();
    }
    const res = await authenticatedApiFetch('/api/runtime');
    if (!res.ok) {
      throw new Error(`런타임 정보 조회 실패 (${res.status})`);
    }
    return (await res.json()) as RuntimeInfo;
  },

  async probeConnectors() {
    if (typeof window !== 'undefined' && window.desktopBridge) {
      return window.desktopBridge.probeConnectors();
    }
    const res = await authenticatedApiFetch('/api/connectors/status');
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

    const res = await authenticatedApiFetch(`/api/connectors/${request.serviceId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        serviceId: request.serviceId,
        channelUsed: null,
        text: '',
        errorCode: 'EXECUTION_FAILED',
        errorMessage: `요청 처리에 실패했습니다. (HTTP ${res.status})`,
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
    const res = await authenticatedApiFetch('/api/storage');
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
    const res = await authenticatedApiFetch('/api/storage', {
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
    const res = await authenticatedApiFetch('/api/storage', { method: 'DELETE' });
    if (!res.ok) {
      throw new Error(`공용 저장소 초기화 실패 (${res.status})`);
    }
  },
};

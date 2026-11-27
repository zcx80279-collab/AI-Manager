import { defaultRuntimeBridge, type RuntimeBridge } from '../runtime/runtimeBridge.ts';
import type {
  AIAgentConfig,
  AIServiceId,
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
  WorkStatus,
} from '../types/controlCenter.ts';

export interface AIConnectorModule {
  serviceId: AIServiceId;
  displayName: string;
  probe: (bridge: RuntimeBridge) => Promise<ConnectorProbeResult>;
  execute: (
    bridge: RuntimeBridge,
    request: ExecuteConnectorRequest,
    signal?: AbortSignal
  ) => Promise<ExecuteConnectorResponse>;
}

function createConnectorModule(
  serviceId: AIServiceId,
  displayName: string
): AIConnectorModule {
  return {
    serviceId,
    displayName,
    async probe(bridge) {
      const all = await bridge.probeConnectors();
      return all.connectors[serviceId];
    },
    async execute(bridge, request, signal) {
      return bridge.executeConnector(request, signal);
    },
  };
}

export const AI_CONNECTORS: Record<AIServiceId, AIConnectorModule> = {
  gpt: createConnectorModule('gpt', 'GPT (OpenAI)'),
  gemini: createConnectorModule('gemini', 'Gemini (Google)'),
  codex: createConnectorModule('codex', 'Codex (OpenAI CLI)'),
  antigravity: createConnectorModule('antigravity', 'Antigravity (Google IDE/CLI)'),
};

export function deriveWorkStatusFromProbe(
  currentAgent: AIAgentConfig,
  probe: ConnectorProbeResult
): WorkStatus {
  if (probe.connectionStatus === '오류') {
    return '오류';
  }
  if (probe.connectionStatus === '미연결') {
    return '미연결';
  }
  if (probe.quota.isExhausted) {
    return '퇴근';
  }
  // Preserve manual off-duty if operator explicitly set it and quota didn't just reset
  if (currentAgent.workStatus === '퇴근' && !probe.quota.isExhausted) {
    return '퇴근';
  }
  if (probe.quota.isApproachingLimit) {
    return '한도 임박';
  }
  return '근무 중';
}

export async function probeAllConnectors(
  bridge: RuntimeBridge = defaultRuntimeBridge
): Promise<Record<AIServiceId, ConnectorProbeResult>> {
  const result = await bridge.probeConnectors();
  return result.connectors;
}

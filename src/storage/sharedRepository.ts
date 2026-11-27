import { defaultRuntimeBridge, type RuntimeBridge } from '../runtime/runtimeBridge.ts';
import type {
  AIAgentConfig,
  DepartmentDefinition,
  SharedControlStore,
} from '../types/controlCenter.ts';

export const DEPARTMENTS: Record<'general_chat' | 'development', DepartmentDefinition> = {
  general_chat: {
    id: 'general_chat',
    name: '일반 채팅 부서',
    responsibilities: [
      '사용자 명령 파악',
      '업무 기획 및 분배',
      '일반 대화',
      '정보 수집 및 정리',
      'AI 간 회의 및 토론',
      '작업 결과 검토 및 보고',
    ],
  },
  development: {
    id: 'development',
    name: '개발 부서',
    responsibilities: [
      '코드 분석',
      '코드 작성 및 수정',
      '기능 구현',
      '오류 수정',
      '테스트 및 검증',
    ],
  },
};

export function createInitialAgents(): AIAgentConfig[] {
  return [
    {
      id: 'gpt',
      name: 'GPT',
      department: 'general_chat',
      rank: '부장',
      isCentralLead: true,
      workStatus: '미연결',
      connectionStatus: '미연결',
      responsibilities: DEPARTMENTS.general_chat.responsibilities,
      probe: null,
    },
    {
      id: 'gemini',
      name: 'Gemini',
      department: 'general_chat',
      rank: '팀장',
      isCentralLead: false,
      workStatus: '미연결',
      connectionStatus: '미연결',
      responsibilities: DEPARTMENTS.general_chat.responsibilities,
      probe: null,
    },
    {
      id: 'codex',
      name: 'Codex',
      department: 'development',
      rank: '팀장',
      isCentralLead: false,
      workStatus: '미연결',
      connectionStatus: '미연결',
      responsibilities: DEPARTMENTS.development.responsibilities,
      probe: null,
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      department: 'development',
      rank: '신입',
      isCentralLead: false,
      workStatus: '미연결',
      connectionStatus: '미연결',
      responsibilities: DEPARTMENTS.development.responsibilities,
      probe: null,
    },
  ];
}

export function createInitialStore(): SharedControlStore {
  return {
    version: '0.1.0',
    agents: createInitialAgents(),
    commands: [],
    tasks: [],
    assignments: [],
    messages: [],
    errors: [],
    lastSavedAt: new Date().toISOString(),
  };
}

export interface SharedStorageProvider {
  load: () => Promise<SharedControlStore>;
  save: (store: SharedControlStore) => Promise<SharedControlStore>;
  reset: () => Promise<SharedControlStore>;
}

export function createSharedRepository(
  bridge: RuntimeBridge = defaultRuntimeBridge
): SharedStorageProvider {
  return {
    async load() {
      const existing = await bridge.loadStore();
      if (existing) {
        return existing;
      }
      const initial = createInitialStore();
      return bridge.saveStore(initial);
    },
    async save(store) {
      return bridge.saveStore(store);
    },
    async reset() {
      await bridge.clearStore();
      const fresh = createInitialStore();
      return bridge.saveStore(fresh);
    },
  };
}

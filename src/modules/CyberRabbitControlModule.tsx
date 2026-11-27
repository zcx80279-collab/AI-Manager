import { useEffect, useRef, useState } from 'react';
import { ApprovalModal, type PendingApprovalAction } from '../components/ApprovalModal.tsx';
import { CentralCommandPanel } from '../components/CentralCommandPanel.tsx';
import { ConnectorDiagnosticsPanel } from '../components/ConnectorDiagnosticsPanel.tsx';
import { DepartmentRosterPanel } from '../components/DepartmentRosterPanel.tsx';
import { MessageFlowLogPanel } from '../components/MessageFlowLogPanel.tsx';
import { CentralControlEngine } from '../engine/centralEngine.ts';
import { defaultRuntimeBridge, type RuntimeBridge } from '../runtime/runtimeBridge.ts';
import {
  createInitialStore,
  createSharedRepository,
  type SharedStorageProvider,
} from '../storage/sharedRepository.ts';
import type {
  AIServiceId,
  CommandTargetMode,
  DepartmentId,
  Rank,
  RuntimeInfo,
  SharedControlStore,
} from '../types/controlCenter.ts';

export interface CyberRabbitControlModuleProps {
  runtimeBridge?: RuntimeBridge;
  storageProvider?: SharedStorageProvider;
  windowTitle?: string;
}

export function CyberRabbitControlModule({
  runtimeBridge = defaultRuntimeBridge,
  storageProvider,
  windowTitle = 'AI 중앙통제실 V0.1 (실험용 독립 프로토타입)',
}: CyberRabbitControlModuleProps) {
  const [store, setStore] = useState<SharedControlStore>(() => createInitialStore());
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [probing, setProbing] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [sessionApproved, setSessionApproved] = useState<boolean>(false);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApprovalAction | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);

  const engineRef = useRef<CentralControlEngine | null>(null);

  useEffect(() => {
    let mounted = true;
    const repo = storageProvider ?? createSharedRepository(runtimeBridge);

    async function bootstrap() {
      setProbing(true);
      try {
        const [rt, loadedStore] = await Promise.all([
          runtimeBridge.getRuntimeInfo(),
          repo.load(),
        ]);
        if (!mounted) return;
        setRuntimeInfo(rt);

        const engine = new CentralControlEngine({
          initialStore: loadedStore,
          storage: repo,
          bridge: runtimeBridge,
          onStoreChange: (next) => {
            if (mounted) {
              setStore(next);
            }
          },
        });
        engineRef.current = engine;
        setStore(engine.getStore());
        await engine.refreshConnectorProbes();
      } catch (err: unknown) {
        if (mounted) {
          setUiNotice(
            err instanceof Error ? err.message : '초기화 중 오류가 발생했습니다.'
          );
        }
      } finally {
        if (mounted) setProbing(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
      engineRef.current?.abortCurrentExecution();
    };
  }, [runtimeBridge, storageProvider]);

  const handleRefreshProbe = async () => {
    if (!engineRef.current) return;
    setProbing(true);
    try {
      await engineRef.current.refreshConnectorProbes();
    } finally {
      setProbing(false);
    }
  };

  const resolveTargetsForPreview = (
    targetMode: CommandTargetMode,
    targetAiId?: AIServiceId
  ) => {
    switch (targetMode) {
      case 'central_lead_auto': {
        const lead = store.agents.find((a) => a.isCentralLead);
        return lead ? [lead, ...store.agents.filter((a) => a.id !== lead.id)] : store.agents;
      }
      case 'broadcast_all':
        return store.agents;
      case 'department_general':
        return store.agents.filter((a) => a.department === 'general_chat');
      case 'department_dev':
        return store.agents.filter((a) => a.department === 'development');
      case 'individual':
        return targetAiId
          ? store.agents.filter((a) => a.id === targetAiId)
          : [];
    }
  };

  const executeDispatch = async (
    params: {
      commandText: string;
      targetMode: CommandTargetMode;
      targetAiId?: AIServiceId;
      maxHops: number;
    },
    approved: boolean
  ) => {
    if (!engineRef.current) return;
    setUiNotice(null);
    setIsRunning(true);
    try {
      await engineRef.current.dispatchCommand({
        ...params,
        userApprovedExecution: approved,
      });
    } catch (err: unknown) {
      setUiNotice(err instanceof Error ? err.message : '명령 실행 오류');
    } finally {
      setIsRunning(false);
    }
  };

  const handleDispatchRequest = (params: {
    commandText: string;
    targetMode: CommandTargetMode;
    targetAiId?: AIServiceId;
    maxHops: number;
  }) => {
    if (sessionApproved) {
      void executeDispatch(params, true);
      return;
    }

    const targets = resolveTargetsForPreview(params.targetMode, params.targetAiId);
    setPendingApproval({
      title: `명령 실행 승인 (${params.targetMode})`,
      description:
        '선택한 대상 AI 서비스의 공식 연결 채널을 통해 명령을 전달합니다.',
      targetAgents: targets,
      promptPreview: params.commandText,
      onConfirm: (rememberForSession) => {
        if (rememberForSession) {
          setSessionApproved(true);
        }
        setPendingApproval(null);
        void executeDispatch(params, true);
      },
    });
  };

  const executeHandoff = async (
    params: { fromAiId: AIServiceId; toAiId: AIServiceId; messageText: string },
    approved: boolean
  ) => {
    if (!engineRef.current) return;
    setUiNotice(null);
    setIsRunning(true);
    try {
      await engineRef.current.verifyInterAiHandoff({
        ...params,
        userApprovedExecution: approved,
      });
    } catch (err: unknown) {
      setUiNotice(err instanceof Error ? err.message : '메시지 전달 오류');
    } finally {
      setIsRunning(false);
    }
  };

  const handleVerifyHandoffRequest = (params: {
    fromAiId: AIServiceId;
    toAiId: AIServiceId;
    messageText: string;
  }) => {
    if (sessionApproved) {
      void executeHandoff(params, true);
      return;
    }

    const targets = store.agents.filter(
      (a) => a.id === params.fromAiId || a.id === params.toAiId
    );
    setPendingApproval({
      title: 'AI 간 메시지 전달 검증 승인',
      description:
        '송신 AI에서 수신 AI로 공통 메시지(CommonAIMessage) 규격을 통해 전달 검증을 실행합니다.',
      targetAgents: targets,
      promptPreview: params.messageText,
      onConfirm: (rememberForSession) => {
        if (rememberForSession) {
          setSessionApproved(true);
        }
        setPendingApproval(null);
        void executeHandoff(params, true);
      },
    });
  };

  return (
    <div className="min-h-screen bg-neutral-200 p-3 text-neutral-900">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2 border border-neutral-600 bg-white px-3 py-2">
          <div>
            <h1 className="text-base font-bold">{windowTitle}</h1>
            <div className="text-[11px] text-neutral-600">
              UI · 중앙 관리 엔진 · AI 연결 모듈 · 공용 저장소 분리 구조 (사이버토끼 OS
              모듈 통합 대비)
            </div>
          </div>
          <div className="font-mono text-xs text-neutral-800">
            환경:{' '}
            {runtimeInfo?.runtimeKind === 'electron-desktop'
              ? 'DESKTOP (Electron)'
              : 'WEB PREVIEW'}
          </div>
        </header>

        {uiNotice && (
          <div className="flex items-center justify-between border border-red-600 bg-red-50 px-3 py-2 text-xs text-red-900">
            <span>{uiNotice}</span>
            <button
              type="button"
              onClick={() => setUiNotice(null)}
              className="border border-red-600 bg-white px-2 py-0.5 text-[11px]"
            >
              닫기
            </button>
          </div>
        )}

        <CentralCommandPanel
          agents={store.agents}
          isRunning={isRunning}
          sessionApproved={sessionApproved}
          onToggleSessionApproved={setSessionApproved}
          onDispatch={handleDispatchRequest}
          onVerifyHandoff={handleVerifyHandoffRequest}
          onAbort={() => engineRef.current?.abortCurrentExecution()}
        />

        <DepartmentRosterPanel
          agents={store.agents}
          onChangeOrganization={(p: {
            agentId: AIServiceId;
            rank?: Rank;
            department?: DepartmentId;
          }) => {
            void engineRef.current?.updateAgentOrganization(p);
          }}
          onSetCentralLead={(id) => {
            void engineRef.current?.setCentralLead(id);
          }}
          onToggleManualWorkStatus={(id, next) => {
            void engineRef.current?.setManualWorkStatus(id, next);
          }}
        />

        <MessageFlowLogPanel
          store={store}
          onResetRecords={() => {
            void engineRef.current?.resetAllRecords();
          }}
        />

        <ConnectorDiagnosticsPanel
          runtimeBridge={runtimeBridge}
          agents={store.agents}
          runtimeInfo={runtimeInfo}
          probing={probing}
          onRefreshProbe={() => {
            void handleRefreshProbe();
          }}
        />
      </div>

      <ApprovalModal
        pending={pendingApproval}
        onCancel={() => setPendingApproval(null)}
      />
    </div>
  );
}

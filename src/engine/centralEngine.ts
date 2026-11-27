import {
  AI_CONNECTORS,
  deriveWorkStatusFromProbe,
  probeAllConnectors,
} from '../connectors/aiConnectors.ts';
import { defaultRuntimeBridge, type RuntimeBridge } from '../runtime/runtimeBridge.ts';
import { DEPARTMENTS, type SharedStorageProvider } from '../storage/sharedRepository.ts';
import type {
  AIAgentConfig,
  AIServiceId,
  CommandRecord,
  CommandTargetMode,
  CommonAIMessage,
  DepartmentId,
  ErrorRecord,
  Rank,
  SharedControlStore,
  TaskAssignment,
  TaskRecord,
} from '../types/controlCenter.ts';

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface ParsedDelegationPlan {
  analysis: string;
  assignments: Array<{
    targetAiId: AIServiceId;
    instruction: string;
  }>;
  directSummary?: string;
}

function tryParseDelegationPlan(
  rawText: string,
  agents: AIAgentConfig[],
  leadId: AIServiceId
): ParsedDelegationPlan | null {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      analysis?: string;
      assignments?: Array<{ targetAiId?: string; instruction?: string }>;
      directSummary?: string;
    };
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const validIds = new Set(agents.map((a) => a.id));
    const assignments = Array.isArray(parsed.assignments)
      ? parsed.assignments
          .filter(
            (item): item is { targetAiId: AIServiceId; instruction: string } =>
              Boolean(item) &&
              typeof item.targetAiId === 'string' &&
              validIds.has(item.targetAiId as AIServiceId) &&
              item.targetAiId !== leadId &&
              typeof item.instruction === 'string' &&
              item.instruction.trim().length > 0
          )
      : [];

    return {
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : rawText,
      assignments,
      directSummary:
        typeof parsed.directSummary === 'string' ? parsed.directSummary : undefined,
    };
  } catch {
    return null;
  }
}

export class CentralControlEngine {
  private store: SharedControlStore;
  private storage: SharedStorageProvider;
  private bridge: RuntimeBridge;
  private abortController: AbortController | null = null;
  private onStoreChange: (next: SharedControlStore) => void;

  constructor(options: {
    initialStore: SharedControlStore;
    storage: SharedStorageProvider;
    bridge?: RuntimeBridge;
    onStoreChange: (next: SharedControlStore) => void;
  }) {
    this.store = options.initialStore;
    this.storage = options.storage;
    this.bridge = options.bridge ?? defaultRuntimeBridge;
    this.onStoreChange = options.onStoreChange;
  }

  public getStore(): SharedControlStore {
    return this.store;
  }

  public isRunning(): boolean {
    return this.abortController !== null;
  }

  public abortCurrentExecution(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async commit(mutator: (draft: SharedControlStore) => SharedControlStore) {
    const next = mutator(this.store);
    this.store = next;
    this.onStoreChange(next);
    try {
      const saved = await this.storage.save(next);
      this.store = saved;
      this.onStoreChange(saved);
    } catch (err: unknown) {
      const errorRecord: ErrorRecord = {
        id: uid('err'),
        code: 'STORAGE_SAVE_ERROR',
        message: err instanceof Error ? err.message : '공용 저장소 저장 오류',
        timestamp: new Date().toISOString(),
      };
      this.store = {
        ...this.store,
        errors: [errorRecord, ...this.store.errors].slice(0, 200),
      };
      this.onStoreChange(this.store);
    }
  }

  public async refreshConnectorProbes(): Promise<SharedControlStore> {
    const probes = await probeAllConnectors(this.bridge);
    await this.commit((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) => {
        const probe = probes[agent.id];
        return {
          ...agent,
          connectionStatus: probe.connectionStatus,
          workStatus: deriveWorkStatusFromProbe(agent, probe),
          probe,
        };
      }),
    }));
    return this.store;
  }

  public async updateAgentOrganization(params: {
    agentId: AIServiceId;
    rank?: Rank;
    department?: DepartmentId;
  }): Promise<void> {
    await this.commit((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) => {
        if (agent.id !== params.agentId) return agent;
        const nextDept = params.department ?? agent.department;
        return {
          ...agent,
          rank: params.rank ?? agent.rank,
          department: nextDept,
          responsibilities: DEPARTMENTS[nextDept].responsibilities,
        };
      }),
    }));
  }

  public async setCentralLead(agentId: AIServiceId): Promise<void> {
    await this.commit((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) => ({
        ...agent,
        isCentralLead: agent.id === agentId,
      })),
    }));
  }

  public async setManualWorkStatus(
    agentId: AIServiceId,
    nextStatus: '근무 중' | '퇴근'
  ): Promise<void> {
    await this.commit((prev) => {
      const target = prev.agents.find((a) => a.id === agentId);
      if (!target || target.connectionStatus !== '연결됨') {
        return prev;
      }
      const sysMsg: CommonAIMessage = {
        id: uid('msg'),
        taskId: 'SYSTEM',
        fromId: 'CENTRAL_ENGINE',
        toId: agentId,
        messageType: 'SYSTEM',
        content: `${target.name} 근무 상태가 관리자 확인으로 [${nextStatus}] 상태로 전환되었습니다.`,
        hopCount: 0,
        timestamp: new Date().toISOString(),
      };
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === agentId
            ? {
                ...a,
                workStatus: nextStatus,
                probe:
                  nextStatus === '근무 중' && a.probe
                    ? {
                        ...a.probe,
                        quota: { ...a.probe.quota, isExhausted: false },
                      }
                    : a.probe,
              }
            : a
        ),
        messages: [...prev.messages, sysMsg],
      };
    });
  }

  public async resetAllRecords(): Promise<void> {
    const fresh = await this.storage.reset();
    this.store = fresh;
    this.onStoreChange(fresh);
    await this.refreshConnectorProbes();
  }

  private async setAgentBusy(agentId: AIServiceId, busy: boolean) {
    await this.commit((prev) => ({
      ...prev,
      agents: prev.agents.map((a) => {
        if (a.id !== agentId) return a;
        if (busy) {
          return { ...a, workStatus: '업무 진행 중' };
        }
        if (a.probe) {
          return { ...a, workStatus: deriveWorkStatusFromProbe(a, a.probe) };
        }
        return {
          ...a,
          workStatus: a.connectionStatus === '연결됨' ? '근무 중' : a.connectionStatus,
        };
      }),
    }));
  }

  private async executeSingleAgent(params: {
    taskId: string;
    agent: AIAgentConfig;
    prompt: string;
    systemInstruction: string;
    userApprovedExecution: boolean;
    contextMessages?: Array<{ from: string; content: string }>;
    signal: AbortSignal;
  }): Promise<{
    ok: boolean;
    text: string;
    channelUsed: string | null;
    blockedReason?: string;
    errorCode?: string;
  }> {
    const { agent, taskId, signal } = params;

    if (signal.aborted) {
      return {
        ok: false,
        text: '',
        channelUsed: null,
        blockedReason: '사용자에 의해 중지됨',
        errorCode: 'ABORTED',
      };
    }

    if (agent.connectionStatus !== '연결됨') {
      return {
        ok: false,
        text: '',
        channelUsed: null,
        blockedReason: `${agent.name} 서비스가 현재 [미연결] 상태이므로 실행하지 않았습니다. (${agent.probe?.reason ?? '연결 정보 없음'})`,
        errorCode: 'NOT_CONNECTED',
      };
    }

    if (agent.workStatus === '퇴근') {
      return {
        ok: false,
        text: '',
        channelUsed: null,
        blockedReason: `${agent.name}이(가) [퇴근] 상태(한도 소진 또는 근무 종료)이므로 업무를 배정하지 않았습니다.`,
        errorCode: 'QUOTA_EXHAUSTED',
      };
    }

    await this.setAgentBusy(agent.id, true);
    try {
      const connector = AI_CONNECTORS[agent.id];
      const res = await connector.execute(
        this.bridge,
        {
          serviceId: agent.id,
          prompt: params.prompt,
          systemInstruction: params.systemInstruction,
          userApprovedExecution: params.userApprovedExecution,
          contextMessages: params.contextMessages,
        },
        signal
      );

      if (res.quotaUpdate || !res.ok) {
        await this.commit((prev) => ({
          ...prev,
          agents: prev.agents.map((a) => {
            if (a.id !== agent.id || !a.probe) return a;
            const nextProbe = {
              ...a.probe,
              quota: {
                ...a.probe.quota,
                ...(res.quotaUpdate ?? {}),
              },
            };
            const isQuotaOut =
              res.errorCode === 'QUOTA_EXHAUSTED' || nextProbe.quota.isExhausted;
            return {
              ...a,
              probe: nextProbe,
              workStatus: isQuotaOut
                ? '퇴근'
                : res.errorCode === 'RATE_LIMITED'
                  ? '한도 임박'
                  : !res.ok && res.errorCode !== 'ABORTED'
                    ? '오류'
                    : deriveWorkStatusFromProbe(a, nextProbe),
            };
          }),
        }));
      } else {
        await this.setAgentBusy(agent.id, false);
      }

      if (!res.ok) {
        const errRecord: ErrorRecord = {
          id: uid('err'),
          taskId,
          serviceId: agent.id,
          code: res.errorCode ?? 'EXECUTION_FAILED',
          message: res.errorMessage ?? '알 수 없는 오류',
          timestamp: res.executedAt,
        };
        await this.commit((prev) => ({
          ...prev,
          errors: [errRecord, ...prev.errors].slice(0, 200),
        }));
        return {
          ok: false,
          text: '',
          channelUsed: res.channelUsed,
          blockedReason: res.errorMessage ?? '실행 실패',
          errorCode: res.errorCode,
        };
      }

      return {
        ok: true,
        text: res.text,
        channelUsed: res.channelUsed,
      };
    } catch (err: unknown) {
      await this.setAgentBusy(agent.id, false);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort
        ? '사용자에 의해 중지됨'
        : err instanceof Error
          ? err.message
          : String(err);
      return {
        ok: false,
        text: '',
        channelUsed: null,
        blockedReason: msg,
        errorCode: isAbort ? 'ABORTED' : 'EXECUTION_FAILED',
      };
    }
  }

  public async dispatchCommand(params: {
    commandText: string;
    targetMode: CommandTargetMode;
    targetAiId?: AIServiceId;
    maxHops: number;
    userApprovedExecution: boolean;
  }): Promise<void> {
    if (this.abortController) {
      throw new Error('이미 진행 중인 명령이 있습니다. 중지 후 다시 시도하세요.');
    }

    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;

    const now = new Date().toISOString();
    const taskId = uid('task');
    const centralLead =
      this.store.agents.find((a) => a.isCentralLead) ?? this.store.agents[0];
    const boundedMaxHops = Math.max(1, Math.min(10, params.maxHops));

    const commandRecord: CommandRecord = {
      id: uid('cmd'),
      taskId,
      rawCommand: params.commandText,
      targetMode: params.targetMode,
      targetAiId: params.targetAiId,
      maxHops: boundedMaxHops,
      approvedPaidExecution: params.userApprovedExecution,
      createdAt: now,
    };

    const initialTask: TaskRecord = {
      id: taskId,
      commandText: params.commandText,
      targetMode: params.targetMode,
      targetAiId: params.targetAiId,
      centralLeadAtCreation: centralLead.id,
      status: 'ANALYZING',
      finalSummary: '처리 중...',
      totalAiCalls: 0,
      maxHops: boundedMaxHops,
      createdAt: now,
      updatedAt: now,
    };

    const userMsg: CommonAIMessage = {
      id: uid('msg'),
      taskId,
      fromId: 'USER',
      toId:
        params.targetMode === 'broadcast_all'
          ? 'ALL'
          : params.targetMode === 'department_general'
            ? 'GENERAL_CHAT'
            : params.targetMode === 'department_dev'
              ? 'DEVELOPMENT'
              : params.targetMode === 'individual' && params.targetAiId
                ? params.targetAiId
                : centralLead.id,
      messageType: 'USER_COMMAND',
      content: params.commandText,
      hopCount: 0,
      timestamp: now,
    };

    await this.commit((prev) => ({
      ...prev,
      commands: [commandRecord, ...prev.commands].slice(0, 100),
      tasks: [initialTask, ...prev.tasks].slice(0, 100),
      messages: [...prev.messages, userMsg],
    }));

    let callCount = 0;

    try {
      if (params.targetMode === 'central_lead_auto') {
        await this.runCentralLeadDelegation({
          taskId,
          commandText: params.commandText,
          centralLead,
          maxHops: boundedMaxHops,
          userApprovedExecution: params.userApprovedExecution,
          signal,
          incrementCallCount: () => {
            callCount += 1;
            return callCount;
          },
        });
      } else {
        const targets = this.resolveDirectTargets(
          params.targetMode,
          params.targetAiId
        );
        let successCount = 0;
        let blockedCount = 0;

        for (const target of targets) {
          if (signal.aborted || callCount >= boundedMaxHops) {
            break;
          }
          callCount += 1;
          const assignmentId = uid('assign');
          const assign: TaskAssignment = {
            id: assignmentId,
            taskId,
            assignedBy: 'USER',
            targetAiId: target.id,
            targetDepartment: target.department,
            instruction: params.commandText,
            status: 'EXECUTING',
            updatedAt: new Date().toISOString(),
          };
          await this.commit((prev) => ({
            ...prev,
            assignments: [assign, ...prev.assignments],
          }));

          const res = await this.executeSingleAgent({
            taskId,
            agent: this.store.agents.find((a) => a.id === target.id) ?? target,
            prompt: params.commandText,
            systemInstruction: `당신은 AI 중앙통제실의 [${DEPARTMENTS[target.department].name}] 소속 [${target.rank}] 등급 AI(${target.name})입니다. 담당 업무(${target.responsibilities.join(', ')}) 관점에서 정확히 응답하세요.`,
            userApprovedExecution: params.userApprovedExecution,
            signal,
          });

          if (res.ok) {
            successCount += 1;
            const msg: CommonAIMessage = {
              id: uid('msg'),
              taskId,
              fromId: target.id,
              toId: 'CENTRAL_ENGINE',
              fromRank: target.rank,
              department: target.department,
              messageType: 'AI_RESPONSE',
              content: res.text,
              structuredPayload: { channelUsed: res.channelUsed },
              hopCount: callCount,
              timestamp: new Date().toISOString(),
            };
            await this.commit((prev) => ({
              ...prev,
              assignments: prev.assignments.map((a) =>
                a.id === assignmentId
                  ? {
                      ...a,
                      status: 'COMPLETED',
                      resultSummary: res.text.slice(0, 200),
                      updatedAt: new Date().toISOString(),
                    }
                  : a
              ),
              messages: [...prev.messages, msg],
            }));
          } else {
            blockedCount += 1;
            const status =
              res.errorCode === 'ABORTED'
                ? 'STOPPED'
                : res.errorCode === 'QUOTA_EXHAUSTED'
                  ? 'BLOCKED_OFF_DUTY'
                  : res.errorCode === 'NOT_CONNECTED' ||
                      res.errorCode === 'CLI_NOT_AVAILABLE'
                    ? 'BLOCKED_DISCONNECTED'
                    : 'ERROR';
            const msg: CommonAIMessage = {
              id: uid('msg'),
              taskId,
              fromId: target.id,
              toId: 'CENTRAL_ENGINE',
              fromRank: target.rank,
              department: target.department,
              messageType: status === 'ERROR' ? 'ERROR' : 'BLOCKED',
              content: res.blockedReason ?? '실행 불가',
              hopCount: callCount,
              timestamp: new Date().toISOString(),
            };
            await this.commit((prev) => ({
              ...prev,
              assignments: prev.assignments.map((a) =>
                a.id === assignmentId
                  ? {
                      ...a,
                      status,
                      reason: res.blockedReason,
                      updatedAt: new Date().toISOString(),
                    }
                  : a
              ),
              messages: [...prev.messages, msg],
            }));
          }
        }

        const finalStatus = signal.aborted
          ? 'STOPPED'
          : successCount > 0 && blockedCount === 0
            ? 'COMPLETED'
            : successCount > 0 && blockedCount > 0
              ? 'PARTIAL'
              : 'BLOCKED';

        await this.commit((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: finalStatus,
                  totalAiCalls: callCount,
                  finalSummary: `대상 ${targets.length}개 중 성공 ${successCount}건 / 미실행·차단 ${blockedCount}건`,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));
      }
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private resolveDirectTargets(
    mode: CommandTargetMode,
    individualId?: AIServiceId
  ): AIAgentConfig[] {
    switch (mode) {
      case 'broadcast_all':
        return this.store.agents;
      case 'department_general':
        return this.store.agents.filter((a) => a.department === 'general_chat');
      case 'department_dev':
        return this.store.agents.filter((a) => a.department === 'development');
      case 'individual':
        return individualId
          ? this.store.agents.filter((a) => a.id === individualId)
          : [];
      default:
        return [];
    }
  }

  private async runCentralLeadDelegation(params: {
    taskId: string;
    commandText: string;
    centralLead: AIAgentConfig;
    maxHops: number;
    userApprovedExecution: boolean;
    signal: AbortSignal;
    incrementCallCount: () => number;
  }) {
    const { taskId, commandText, centralLead, maxHops, signal } = params;
    const rosterDescription = this.store.agents
      .map(
        (a) =>
          `- id: "${a.id}", 이름: ${a.name}, 부서: ${DEPARTMENTS[a.department].name}, 직급: ${a.rank}, 연결상태: ${a.connectionStatus}, 근무상태: ${a.workStatus}, 담당: ${a.responsibilities.join('/')}`
      )
      .join('\n');

    const leadCallIndex = params.incrementCallCount();
    const leadSystem = `당신은 AI 중앙통제실의 [중앙 통제 담당자]이자 [${centralLead.rank}] 등급(${centralLead.name})입니다.
원칙: 관리직 AI는 모든 실무를 혼자 처리하지 않고, 아래 조직원 현황을 파악하여 적절한 담당 AI에게 업무를 분배합니다.
단, [미연결] 또는 [퇴근] 상태인 AI라도 업무 성격상 원래 해당 부서(예: 코드 구현은 개발 부서 Codex/Antigravity) 담당이면 그대로 배정 계획을 적되, 연결 상태를 고려한 안내를 analysis에 명시하세요.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "analysis": "명령 해석 및 배분 근거",
  "assignments": [
    { "targetAiId": "gemini|gpt|codex|antigravity 중 본인(${centralLead.id}) 제외", "instruction": "구체적 지시사항" }
  ],
  "directSummary": "일반 채팅 부서 차원의 즉시 안내가 필요하면 작성"
}`;

    const leadRes = await this.executeSingleAgent({
      taskId,
      agent: centralLead,
      prompt: `[현재 조직원 현황]\n${rosterDescription}\n\n[사용자 명령]\n${commandText}`,
      systemInstruction: leadSystem,
      userApprovedExecution: params.userApprovedExecution,
      signal,
    });

    if (!leadRes.ok) {
      const blockedMsg: CommonAIMessage = {
        id: uid('msg'),
        taskId,
        fromId: centralLead.id,
        toId: 'CENTRAL_ENGINE',
        fromRank: centralLead.rank,
        department: centralLead.department,
        messageType: leadRes.errorCode === 'ABORTED' ? 'SYSTEM' : 'BLOCKED',
        content: `중앙 통제 담당자(${centralLead.name}) 실행 불가: ${leadRes.blockedReason}. 상단 조직 관리에서 연결된 AI(예: Gemini)로 중앙 통제 담당자를 변경하거나 개별 명령을 사용하세요.`,
        hopCount: leadCallIndex,
        timestamp: new Date().toISOString(),
      };
      await this.commit((prev) => ({
        ...prev,
        messages: [...prev.messages, blockedMsg],
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: leadRes.errorCode === 'ABORTED' ? 'STOPPED' : 'BLOCKED',
                totalAiCalls: leadCallIndex,
                finalSummary: blockedMsg.content,
                updatedAt: new Date().toISOString(),
              }
            : t
        ),
      }));
      return;
    }

    const plan = tryParseDelegationPlan(leadRes.text, this.store.agents, centralLead.id);
    const planMsg: CommonAIMessage = {
      id: uid('msg'),
      taskId,
      fromId: centralLead.id,
      toId: 'CENTRAL_ENGINE',
      fromRank: centralLead.rank,
      department: centralLead.department,
      messageType: 'DELEGATION_PLAN',
      content: plan ? plan.analysis : leadRes.text,
      structuredPayload: plan
        ? { assignments: plan.assignments, directSummary: plan.directSummary }
        : undefined,
      hopCount: leadCallIndex,
      timestamp: new Date().toISOString(),
    };

    await this.commit((prev) => ({
      ...prev,
      messages: [...prev.messages, planMsg],
      tasks: prev.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'DELEGATED', updatedAt: new Date().toISOString() } : t
      ),
    }));

    const plannedAssignments = plan?.assignments ?? [];
    if (plannedAssignments.length === 0) {
      await this.commit((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'COMPLETED',
                totalAiCalls: leadCallIndex,
                finalSummary: plan?.directSummary || plan?.analysis || leadRes.text,
                updatedAt: new Date().toISOString(),
              }
            : t
        ),
      }));
      return;
    }

    const collectedResults: Array<{ from: string; content: string }> = [];
    let okCount = 0;
    let failCount = 0;

    for (const item of plannedAssignments) {
      if (signal.aborted) break;
      const target = this.store.agents.find((a) => a.id === item.targetAiId);
      if (!target) continue;

      const currentCall = params.incrementCallCount();
      if (currentCall > maxHops) {
        const stopMsg: CommonAIMessage = {
          id: uid('msg'),
          taskId,
          fromId: 'CENTRAL_ENGINE',
          toId: target.id,
          messageType: 'SYSTEM',
          content: `최대 호출 제한(${maxHops}회)에 도달하여 추가 AI 전달을 중단했습니다.`,
          hopCount: currentCall,
          timestamp: new Date().toISOString(),
        };
        await this.commit((prev) => ({ ...prev, messages: [...prev.messages, stopMsg] }));
        break;
      }

      const handoffMsg: CommonAIMessage = {
        id: uid('msg'),
        taskId,
        fromId: centralLead.id,
        toId: target.id,
        fromRank: centralLead.rank,
        department: centralLead.department,
        messageType: 'INTER_AI_HANDOFF',
        content: item.instruction,
        hopCount: currentCall,
        timestamp: new Date().toISOString(),
      };

      const assignmentId = uid('assign');
      const assignment: TaskAssignment = {
        id: assignmentId,
        taskId,
        assignedBy: centralLead.id,
        targetAiId: target.id,
        targetDepartment: target.department,
        instruction: item.instruction,
        status: 'EXECUTING',
        updatedAt: new Date().toISOString(),
      };

      await this.commit((prev) => ({
        ...prev,
        assignments: [assignment, ...prev.assignments],
        messages: [...prev.messages, handoffMsg],
      }));

      const staffRes = await this.executeSingleAgent({
        taskId,
        agent: target,
        prompt: item.instruction,
        systemInstruction: `당신은 AI 중앙통제실의 [${DEPARTMENTS[target.department].name}] 소속 [${target.rank}] 등급 AI(${target.name})입니다. 중앙 통제 담당자(${centralLead.name})로부터 전달받은 업무를 수행하세요.`,
        userApprovedExecution: params.userApprovedExecution,
        contextMessages: [{ from: centralLead.name, content: plan?.analysis ?? commandText }],
        signal,
      });

      if (staffRes.ok) {
        okCount += 1;
        collectedResults.push({ from: target.name, content: staffRes.text });
        const respMsg: CommonAIMessage = {
          id: uid('msg'),
          taskId,
          fromId: target.id,
          toId: centralLead.id,
          fromRank: target.rank,
          department: target.department,
          messageType: 'AI_RESPONSE',
          content: staffRes.text,
          hopCount: currentCall,
          timestamp: new Date().toISOString(),
        };
        await this.commit((prev) => ({
          ...prev,
          assignments: prev.assignments.map((a) =>
            a.id === assignmentId
              ? {
                  ...a,
                  status: 'COMPLETED',
                  resultSummary: staffRes.text.slice(0, 200),
                  updatedAt: new Date().toISOString(),
                }
              : a
          ),
          messages: [...prev.messages, respMsg],
        }));
      } else {
        failCount += 1;
        const status =
          staffRes.errorCode === 'ABORTED'
            ? 'STOPPED'
            : staffRes.errorCode === 'QUOTA_EXHAUSTED'
              ? 'BLOCKED_OFF_DUTY'
              : staffRes.errorCode === 'NOT_CONNECTED' ||
                  staffRes.errorCode === 'CLI_NOT_AVAILABLE'
                ? 'BLOCKED_DISCONNECTED'
                : 'ERROR';
        const blockedMsg: CommonAIMessage = {
          id: uid('msg'),
          taskId,
          fromId: target.id,
          toId: centralLead.id,
          fromRank: target.rank,
          department: target.department,
          messageType: status === 'ERROR' ? 'ERROR' : 'BLOCKED',
          content: staffRes.blockedReason ?? '실행 불가',
          hopCount: currentCall,
          timestamp: new Date().toISOString(),
        };
        await this.commit((prev) => ({
          ...prev,
          assignments: prev.assignments.map((a) =>
            a.id === assignmentId
              ? {
                  ...a,
                  status,
                  reason: staffRes.blockedReason,
                  updatedAt: new Date().toISOString(),
                }
              : a
          ),
          messages: [...prev.messages, blockedMsg],
        }));
      }
    }

    const totalCalls = Math.min(maxHops, 1 + plannedAssignments.length);
    const finalStatus = signal.aborted
      ? 'STOPPED'
      : okCount > 0 && failCount === 0
        ? 'COMPLETED'
        : okCount > 0 || Boolean(plan?.directSummary)
          ? 'PARTIAL'
          : 'BLOCKED';

    await this.commit((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: finalStatus,
              totalAiCalls: totalCalls,
              finalSummary:
                collectedResults.length > 0
                  ? `중앙 통제(${centralLead.name}) 배분 완료 — 수행 ${okCount}건, 미연결/차단 ${failCount}건`
                  : `중앙 통제(${centralLead.name}) 분석 완료 — 실무 대상 ${failCount}건 미연결/차단`,
              updatedAt: new Date().toISOString(),
            }
          : t
      ),
    }));
  }

  public async verifyInterAiHandoff(params: {
    fromAiId: AIServiceId;
    toAiId: AIServiceId;
    messageText: string;
    userApprovedExecution: boolean;
  }): Promise<void> {
    if (this.abortController) {
      throw new Error('진행 중인 작업이 완료되거나 중지된 후 실행하세요.');
    }

    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;
    const taskId = uid('handoff');
    const now = new Date().toISOString();

    const fromAgent = this.store.agents.find((a) => a.id === params.fromAiId)!;
    const toAgent = this.store.agents.find((a) => a.id === params.toAiId)!;

    const handoffTask: TaskRecord = {
      id: taskId,
      commandText: `[AI 간 메시지 전달 검증] ${fromAgent.name} -> ${toAgent.name}: ${params.messageText}`,
      targetMode: 'individual',
      targetAiId: toAgent.id,
      centralLeadAtCreation: fromAgent.id,
      status: 'IN_PROGRESS',
      finalSummary: 'AI 간 전달 검증 진행 중...',
      totalAiCalls: 0,
      maxHops: 2,
      createdAt: now,
      updatedAt: now,
    };

    await this.commit((prev) => ({
      ...prev,
      tasks: [handoffTask, ...prev.tasks].slice(0, 100),
    }));

    try {
      // Hop 1: Source AI prepares standardized CommonAIMessage content
      const hop1 = await this.executeSingleAgent({
        taskId,
        agent: fromAgent,
        prompt: `다음 내용을 수신 AI(${toAgent.name}, ${DEPARTMENTS[toAgent.department].name} ${toAgent.rank})에게 전달할 실무 인계 메시지로 3문장 이내 요약 작성하세요:\n${params.messageText}`,
        systemInstruction: `당신은 ${fromAgent.name}(${fromAgent.rank})입니다. 다른 AI 부서원에게 전달할 간결한 인계 메시지를 작성합니다.`,
        userApprovedExecution: params.userApprovedExecution,
        signal,
      });

      const payloadContent = hop1.ok ? hop1.text : params.messageText;
      const handoffMsg: CommonAIMessage = {
        id: uid('msg'),
        taskId,
        fromId: fromAgent.id,
        toId: toAgent.id,
        fromRank: fromAgent.rank,
        department: fromAgent.department,
        messageType: hop1.ok ? 'INTER_AI_HANDOFF' : 'BLOCKED',
        content: hop1.ok
          ? payloadContent
          : `송신 AI(${fromAgent.name}) 호출 실패로 원본 메시지 직접 전달 시도: ${hop1.blockedReason}`,
        hopCount: 1,
        timestamp: new Date().toISOString(),
      };
      await this.commit((prev) => ({
        ...prev,
        messages: [...prev.messages, handoffMsg],
      }));

      // Hop 2: Destination AI receives CommonAIMessage
      const hop2 = await this.executeSingleAgent({
        taskId,
        agent: toAgent,
        prompt: `송신 AI(${fromAgent.name})로부터 전달받은 인계 메시지입니다. 수신 확인 및 검토 의견을 응답하세요:\n${payloadContent}`,
        systemInstruction: `당신은 ${toAgent.name}(${DEPARTMENTS[toAgent.department].name} ${toAgent.rank})입니다.`,
        userApprovedExecution: params.userApprovedExecution,
        contextMessages: [{ from: fromAgent.name, content: payloadContent }],
        signal,
      });

      const replyMsg: CommonAIMessage = {
        id: uid('msg'),
        taskId,
        fromId: toAgent.id,
        toId: fromAgent.id,
        fromRank: toAgent.rank,
        department: toAgent.department,
        messageType: hop2.ok ? 'AI_RESPONSE' : 'BLOCKED',
        content: hop2.ok ? hop2.text : hop2.blockedReason ?? '수신 AI 미연결/실행 불가',
        hopCount: 2,
        timestamp: new Date().toISOString(),
      };

      const finalStatus =
        hop1.ok && hop2.ok ? 'COMPLETED' : hop1.ok || hop2.ok ? 'PARTIAL' : 'BLOCKED';

      await this.commit((prev) => ({
        ...prev,
        messages: [...prev.messages, replyMsg],
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: finalStatus,
                totalAiCalls: (hop1.ok ? 1 : 0) + (hop2.ok ? 1 : 0),
                finalSummary: `송신(${fromAgent.name}): ${hop1.ok ? '성공' : '불가'} / 수신(${toAgent.name}): ${hop2.ok ? '성공' : '불가'}`,
                updatedAt: new Date().toISOString(),
              }
            : t
        ),
      }));
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }
}

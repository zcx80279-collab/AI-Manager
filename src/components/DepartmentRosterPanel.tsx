import { DEPARTMENTS } from '../storage/sharedRepository.ts';
import type {
  AIAgentConfig,
  AIServiceId,
  DepartmentId,
  Rank,
} from '../types/controlCenter.ts';

interface DepartmentRosterPanelProps {
  agents: AIAgentConfig[];
  onChangeOrganization: (params: {
    agentId: AIServiceId;
    rank?: Rank;
    department?: DepartmentId;
  }) => void;
  onSetCentralLead: (agentId: AIServiceId) => void;
  onToggleManualWorkStatus: (
    agentId: AIServiceId,
    nextStatus: '근무 중' | '퇴근'
  ) => void;
}

const RANKS: Rank[] = ['부장', '팀장', '신입'];

function workStatusClass(status: AIAgentConfig['workStatus']): string {
  switch (status) {
    case '근무 중':
      return 'border-emerald-700 bg-emerald-50 text-emerald-900';
    case '업무 진행 중':
      return 'border-blue-700 bg-blue-50 text-blue-900';
    case '한도 임박':
      return 'border-amber-700 bg-amber-50 text-amber-900';
    case '퇴근':
      return 'border-neutral-600 bg-neutral-200 text-neutral-800';
    case '오류':
      return 'border-red-700 bg-red-50 text-red-900';
    default:
      return 'border-neutral-400 bg-neutral-100 text-neutral-700';
  }
}

export function DepartmentRosterPanel({
  agents,
  onChangeOrganization,
  onSetCentralLead,
  onToggleManualWorkStatus,
}: DepartmentRosterPanelProps) {
  const generalAgents = agents.filter((a) => a.department === 'general_chat');
  const devAgents = agents.filter((a) => a.department === 'development');

  const renderDeptSummary = (
    deptId: DepartmentId,
    deptAgents: AIAgentConfig[]
  ) => {
    const dept = DEPARTMENTS[deptId];
    const connectedCount = deptAgents.filter(
      (a) => a.connectionStatus === '연결됨'
    ).length;
    const workingCount = deptAgents.filter(
      (a) => a.workStatus === '근무 중' || a.workStatus === '업무 진행 중'
    ).length;

    return (
      <div className="border border-neutral-400 bg-neutral-50 p-2.5">
        <div className="flex items-center justify-between border-b border-neutral-300 pb-1.5">
          <div className="text-xs font-bold text-neutral-900">{dept.name}</div>
          <div className="font-mono text-[11px] text-neutral-700">
            연결 {connectedCount}/{deptAgents.length} | 가동 {workingCount}
          </div>
        </div>
        <div className="mt-1.5 text-[11px] text-neutral-700">
          <span className="font-semibold">담당 업무:</span>{' '}
          {dept.responsibilities.join(', ')}
        </div>
        <div className="mt-1.5 text-[11px] text-neutral-700">
          <span className="font-semibold">소속 AI:</span>{' '}
          {deptAgents.length > 0
            ? deptAgents
                .map((a) => `${a.name}(${a.rank}/${a.workStatus})`)
                .join(', ')
            : '없음'}
        </div>
      </div>
    );
  };

  return (
    <section className="border border-neutral-500 bg-white p-3">
      <div className="border-b border-neutral-300 pb-2">
        <h2 className="text-sm font-bold text-neutral-900">
          2. 부서, 조직·직급 및 사용 한도·근무 상태 관리
        </h2>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {renderDeptSummary('general_chat', generalAgents)}
        {renderDeptSummary('development', devAgents)}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse border border-neutral-400 text-left text-xs">
          <thead>
            <tr className="bg-neutral-100">
              <th className="border border-neutral-400 px-2 py-1.5">AI 이름</th>
              <th className="border border-neutral-400 px-2 py-1.5">소속 부서</th>
              <th className="border border-neutral-400 px-2 py-1.5">직급</th>
              <th className="border border-neutral-400 px-2 py-1.5">
                중앙 통제 담당
              </th>
              <th className="border border-neutral-400 px-2 py-1.5">연결 상태</th>
              <th className="border border-neutral-400 px-2 py-1.5">근무 상태</th>
              <th className="border border-neutral-400 px-2 py-1.5">
                잔여 사용 한도
              </th>
              <th className="border border-neutral-400 px-2 py-1.5">
                한도 초기화 예정 시간
              </th>
              <th className="border border-neutral-400 px-2 py-1.5">
                세션 호출 / 제어
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id} className="align-top">
                <td className="border border-neutral-400 px-2 py-1.5 font-bold">
                  {agent.name}
                </td>
                <td className="border border-neutral-400 px-2 py-1.5">
                  <select
                    value={agent.department}
                    onChange={(e) =>
                      onChangeOrganization({
                        agentId: agent.id,
                        department: e.target.value as DepartmentId,
                      })
                    }
                    className="border border-neutral-400 bg-white px-1.5 py-0.5 text-xs"
                  >
                    <option value="general_chat">일반 채팅 부서</option>
                    <option value="development">개발 부서</option>
                  </select>
                </td>
                <td className="border border-neutral-400 px-2 py-1.5">
                  <select
                    value={agent.rank}
                    onChange={(e) =>
                      onChangeOrganization({
                        agentId: agent.id,
                        rank: e.target.value as Rank,
                      })
                    }
                    className="border border-neutral-400 bg-white px-1.5 py-0.5 text-xs"
                  >
                    {RANKS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border border-neutral-400 px-2 py-1.5">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="centralLead"
                      checked={agent.isCentralLead}
                      onChange={() => onSetCentralLead(agent.id)}
                    />
                    <span>{agent.isCentralLead ? '담당자' : '지정'}</span>
                  </label>
                </td>
                <td className="border border-neutral-400 px-2 py-1.5 font-mono">
                  <span
                    className={
                      agent.connectionStatus === '연결됨'
                        ? 'font-bold text-emerald-800'
                        : 'text-neutral-600'
                    }
                  >
                    {agent.connectionStatus}
                  </span>
                </td>
                <td className="border border-neutral-400 px-2 py-1.5">
                  <span
                    className={`inline-block border px-1.5 py-0.5 font-mono text-[11px] ${workStatusClass(
                      agent.workStatus
                    )}`}
                  >
                    {agent.workStatus}
                  </span>
                </td>
                <td className="border border-neutral-400 px-2 py-1.5 font-mono text-[11px]">
                  {agent.probe?.quota.remainingQuotaLabel ?? '확인 불가'}
                </td>
                <td className="border border-neutral-400 px-2 py-1.5 font-mono text-[11px]">
                  {agent.probe?.quota.resetTimeLabel ?? '확인 불가'}
                </td>
                <td className="border border-neutral-400 px-2 py-1.5 text-[11px]">
                  <div className="font-mono">
                    호출: {agent.probe?.quota.sessionCallCount ?? 0}회
                  </div>
                  {agent.connectionStatus === '연결됨' && (
                    <button
                      type="button"
                      onClick={() =>
                        onToggleManualWorkStatus(
                          agent.id,
                          agent.workStatus === '퇴근' ? '근무 중' : '퇴근'
                        )
                      }
                      className="mt-1 border border-neutral-500 bg-neutral-100 px-1.5 py-0.5 text-[11px] hover:bg-neutral-200"
                    >
                      {agent.workStatus === '퇴근'
                        ? '근무 복귀(초기화)'
                        : '퇴근 처리'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

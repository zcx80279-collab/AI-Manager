import { useState } from 'react';
import type {
  AIAgentConfig,
  AIServiceId,
  CommandTargetMode,
} from '../types/controlCenter.ts';

interface CentralCommandPanelProps {
  agents: AIAgentConfig[];
  isRunning: boolean;
  sessionApproved: boolean;
  onToggleSessionApproved: (next: boolean) => void;
  onDispatch: (params: {
    commandText: string;
    targetMode: CommandTargetMode;
    targetAiId?: AIServiceId;
    maxHops: number;
  }) => void;
  onVerifyHandoff: (params: {
    fromAiId: AIServiceId;
    toAiId: AIServiceId;
    messageText: string;
  }) => void;
  onAbort: () => void;
}

export function CentralCommandPanel({
  agents,
  isRunning,
  sessionApproved,
  onToggleSessionApproved,
  onDispatch,
  onVerifyHandoff,
  onAbort,
}: CentralCommandPanelProps) {
  const [commandText, setCommandText] = useState('');
  const [targetMode, setTargetMode] =
    useState<CommandTargetMode>('central_lead_auto');
  const [individualAi, setIndividualAi] = useState<AIServiceId>('gemini');
  const [maxHops, setMaxHops] = useState<number>(4);

  const [handoffFrom, setHandoffFrom] = useState<AIServiceId>('gemini');
  const [handoffTo, setHandoffTo] = useState<AIServiceId>('codex');
  const [handoffText, setHandoffText] = useState(
    '중앙 명령 분석 결과를 전달합니다. 개발 부서 검토를 진행해 주세요.'
  );

  const centralLead = agents.find((a) => a.isCentralLead) ?? agents[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandText.trim();
    if (!trimmed || isRunning) return;
    onDispatch({
      commandText: trimmed,
      targetMode,
      targetAiId: targetMode === 'individual' ? individualAi : undefined,
      maxHops,
    });
  };

  const handleHandoff = () => {
    const trimmed = handoffText.trim();
    if (!trimmed || isRunning) return;
    onVerifyHandoff({
      fromAiId: handoffFrom,
      toAiId: handoffTo,
      messageText: trimmed,
    });
  };

  return (
    <section className="border border-neutral-500 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-300 pb-2">
        <h2 className="text-sm font-bold text-neutral-900">
          1. 중앙 명령 영역 (Central Command)
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span>
            현재 중앙 통제 담당자:{' '}
            <strong className="font-mono">
              {centralLead.name} ({centralLead.rank}, {centralLead.connectionStatus})
            </strong>
          </span>
          <label className="flex items-center gap-1.5 border border-neutral-400 bg-neutral-50 px-2 py-0.5">
            <input
              type="checkbox"
              checked={sessionApproved}
              onChange={(e) => onToggleSessionApproved(e.target.checked)}
              className="h-3.5 w-3.5 rounded-none"
            />
            <span>세션 실행 승인됨</span>
          </label>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-3 space-y-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-800">
              명령 대상 선택
            </label>
            <select
              value={targetMode}
              onChange={(e) =>
                setTargetMode(e.target.value as CommandTargetMode)
              }
              className="w-full border border-neutral-500 bg-white px-2 py-1.5 text-xs"
              disabled={isRunning}
            >
              <option value="central_lead_auto">
                중앙 통제 담당자 자동 분배 ({centralLead.name} 경유)
              </option>
              <option value="broadcast_all">전체 명령 (모든 AI 일괄)</option>
              <option value="department_general">일반 채팅 부서 명령</option>
              <option value="department_dev">개발 부서 명령</option>
              <option value="individual">개별 AI 직접 명령</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-800">
              개별 AI 지정 (개별 명령 시)
            </label>
            <select
              value={individualAi}
              onChange={(e) => setIndividualAi(e.target.value as AIServiceId)}
              disabled={targetMode !== 'individual' || isRunning}
              className="w-full border border-neutral-500 bg-white px-2 py-1.5 text-xs disabled:bg-neutral-100 disabled:text-neutral-500"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.rank} / {a.connectionStatus} / {a.workStatus})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-800">
              호출 횟수 상한 (무한 반복 방지)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value) || 4)}
              disabled={isRunning}
              className="w-full border border-neutral-500 bg-white px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-800">
            사용자 명령 입력
          </label>
          <textarea
            rows={3}
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            placeholder="명령을 입력하세요. (예: 중앙 관리 엔진의 타입 구조를 점검하고 요약 보고서를 작성하라)"
            disabled={isRunning}
            className="w-full border border-neutral-500 bg-white p-2 text-xs leading-relaxed focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-600">
            미연결 또는 퇴근 상태 AI에는 가짜 응답을 생성하지 않고 차단 사유만 기록합니다.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAbort}
              disabled={!isRunning}
              className="border border-red-700 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:border-neutral-300 disabled:text-neutral-400"
            >
              중지 (Abort)
            </button>
            <button
              type="submit"
              disabled={isRunning || commandText.trim().length === 0}
              className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-400"
            >
              {isRunning ? '처리 중...' : '명령 전송'}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-3 border-t border-neutral-300 pt-3">
        <div className="mb-1.5 text-xs font-bold text-neutral-800">
          AI 간 메시지 전달 검증 (CommonAIMessage 규격 테스트)
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <select
            value={handoffFrom}
            onChange={(e) => setHandoffFrom(e.target.value as AIServiceId)}
            disabled={isRunning}
            className="border border-neutral-400 bg-white px-2 py-1 text-xs"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                송신: {a.name}
              </option>
            ))}
          </select>
          <select
            value={handoffTo}
            onChange={(e) => setHandoffTo(e.target.value as AIServiceId)}
            disabled={isRunning}
            className="border border-neutral-400 bg-white px-2 py-1 text-xs"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                수신: {a.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={handoffText}
            onChange={(e) => setHandoffText(e.target.value)}
            disabled={isRunning}
            className="border border-neutral-400 bg-white px-2 py-1 text-xs md:col-span-3"
            placeholder="전달할 메시지 내용"
          />
          <button
            type="button"
            onClick={handleHandoff}
            disabled={isRunning || handoffText.trim().length === 0}
            className="border border-neutral-700 bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-900 hover:bg-neutral-200 disabled:text-neutral-400"
          >
            전달 검증 실행
          </button>
        </div>
      </div>
    </section>
  );
}

import type { AIAgentConfig } from '../types/controlCenter.ts';

export interface PendingApprovalAction {
  title: string;
  description: string;
  targetAgents: AIAgentConfig[];
  promptPreview: string;
  onConfirm: (rememberForSession: boolean) => void;
}

interface ApprovalModalProps {
  pending: PendingApprovalAction | null;
  onCancel: () => void;
}

import { useState } from 'react';

export function ApprovalModal({ pending, onCancel }: ApprovalModalProps) {
  const [remember, setRemember] = useState(false);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl border-2 border-neutral-900 bg-white p-4 text-neutral-900">
        <div className="border-b border-neutral-400 pb-2 text-sm font-bold">
          외부 AI 실행 / 비용 발생 사전 승인 확인
        </div>

        <div className="mt-3 space-y-2 text-xs">
          <div className="font-semibold">{pending.title}</div>
          <p className="text-neutral-700">{pending.description}</p>

          <div className="border border-neutral-300 bg-neutral-50 p-2">
            <div className="font-semibold">대상 AI 및 연결 경로</div>
            <ul className="mt-1 space-y-1">
              {pending.targetAgents.map((agent) => (
                <li key={agent.id} className="font-mono">
                  - {agent.name} ({agent.connectionStatus}):{' '}
                  {agent.probe?.activeChannel ?? '미연결 (호출 차단 예정)'}
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-neutral-300 bg-neutral-50 p-2">
            <div className="font-semibold">전송 예정 내용 미리보기</div>
            <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-neutral-800">
              {pending.promptPreview}
            </div>
          </div>

          <div className="border border-amber-700 bg-amber-50 p-2 text-amber-950">
            유료 API 키 또는 로컬 CLI가 연결된 서비스는 실제 호출 시 토큰 비용 또는
            구독 한도가 차감될 수 있습니다. 연결되지 않은 서비스에는 가짜 응답을
            생성하지 않고 미연결 기록만 남깁니다.
          </div>

          <label className="flex items-center gap-2 pt-1 text-xs">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded-none border border-neutral-600"
            />
            <span>이번 세션 동안 추가 확인 없이 실행 승인 유지</span>
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-neutral-300 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="border border-neutral-500 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-100"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => pending.onConfirm(remember)}
            className="border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
          >
            승인 후 실행
          </button>
        </div>
      </div>
    </div>
  );
}

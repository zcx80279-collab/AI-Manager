import { useState } from 'react';
import type { RuntimeBridge } from '../runtime/runtimeBridge.ts';
import type { AIAgentConfig, RuntimeInfo } from '../types/controlCenter.ts';

interface ConnectorDiagnosticsPanelProps {
  agents: AIAgentConfig[];
  runtimeInfo: RuntimeInfo | null;
  probing: boolean;
  onRefreshProbe: () => void;
  runtimeBridge: RuntimeBridge;
}

export function ConnectorDiagnosticsPanel({
  agents,
  runtimeInfo,
  probing,
  onRefreshProbe,
  runtimeBridge,
}: ConnectorDiagnosticsPanelProps) {
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const changeGptSession = async (action: 'in' | 'out') => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (action === 'in') await runtimeBridge.signInGpt();
      else await runtimeBridge.signOutGpt();
      onRefreshProbe();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'ChatGPT 인증 오류');
    } finally {
      setAuthBusy(false);
    }
  };
  return (
    <section className="border border-neutral-500 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-300 pb-2">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">
            4. AI 서비스별 공식 연결 검증 및 환경 진단
          </h2>
          <div className="font-mono text-[11px] text-neutral-700">
            현재 실행 환경:{' '}
            {runtimeInfo
              ? `${runtimeInfo.runtimeKind === 'electron-desktop' ? 'Electron 데스크톱' : '웹 미리보기'} (${runtimeInfo.platform})`
              : '확인 중...'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefreshProbe}
          disabled={probing}
          className="border border-neutral-700 bg-neutral-100 px-2.5 py-1 text-xs font-semibold hover:bg-neutral-200 disabled:text-neutral-400"
        >
          {probing ? '점검 중...' : '연결 상태 재점검'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {agents.map((agent) => {
          const probe = agent.probe;
          return (
            <div
              key={agent.id}
              className="border border-neutral-400 bg-neutral-50 p-2.5 text-xs"
            >
              <div className="flex items-center justify-between border-b border-neutral-300 pb-1">
                <span className="font-bold">
                  {agent.name} ({agent.id})
                </span>
                <span
                  className={`border px-1.5 py-0.5 font-mono text-[11px] ${
                    agent.connectionStatus === '연결됨'
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                      : 'border-neutral-500 bg-white text-neutral-700'
                  }`}
                >
                  {agent.connectionStatus}
                </span>
              </div>

              <div className="mt-1.5 space-y-1 text-[11px]">
                <div>
                  <strong>활성 채널:</strong>{' '}
                  <span className="font-mono">
                    {probe?.activeChannel ?? '없음 (미연결)'}
                  </span>
                </div>
                <div>
                  <strong>진단 사유:</strong> {probe?.reason ?? '점검 전'}
                </div>
                <div className="text-neutral-700">
                  <strong>구독/인증 안내:</strong>{' '}
                  {probe?.subscriptionSupportNote ?? '-'}
                </div>
              </div>
              {agent.id === 'gpt' && runtimeInfo?.runtimeKind === 'electron-desktop' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={authBusy} onClick={() => void changeGptSession('in')} className="border border-neutral-700 bg-neutral-100 px-2.5 py-1 text-xs font-semibold hover:bg-neutral-200 disabled:text-neutral-400">ChatGPT 로그인 / 재로그인</button>
                  <button type="button" disabled={authBusy || agent.connectionStatus !== '연결됨'} onClick={() => void changeGptSession('out')} className="border border-neutral-700 bg-neutral-100 px-2.5 py-1 text-xs font-semibold hover:bg-neutral-200 disabled:text-neutral-400">로그아웃</button>
                  {probe?.quota.isExhausted && <button type="button" disabled={authBusy} onClick={() => { void runtimeBridge.resumeGptAfterLimit().then(onRefreshProbe).catch(error => setAuthError(error instanceof Error ? error.message : '재시도 준비 실패')); }} className="border border-neutral-700 bg-neutral-100 px-2.5 py-1 text-xs font-semibold hover:bg-neutral-200 disabled:text-neutral-400">사용량 확인 후 재시도</button>}
                  {authError && <div className="w-full text-red-700">{authError}</div>}
                </div>
              )}

              {probe && probe.officialMethods.length > 0 && (
                <div className="mt-2 border-t border-neutral-300 pt-1.5">
                  <div className="mb-1 text-[11px] font-semibold">
                    공식 지원 연결 방식 점검:
                  </div>
                  <ul className="space-y-1 text-[11px]">
                    {probe.officialMethods.map((m) => (
                      <li
                        key={m.method}
                        className="border border-neutral-300 bg-white p-1.5"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span>
                            [{m.type}] {m.method}
                          </span>
                          <span
                            className={
                              m.availableNow
                                ? 'font-bold text-emerald-800'
                                : 'text-neutral-500'
                            }
                          >
                            {m.availableNow ? '사용 가능' : '미감지/불가'}
                          </span>
                        </div>
                        <div className="mt-0.5 text-neutral-700">
                          인증: {m.authMode} — {m.note}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

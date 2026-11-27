import { useState } from 'react';
import type { SharedControlStore } from '../types/controlCenter.ts';

interface MessageFlowLogPanelProps {
  store: SharedControlStore;
  onResetRecords: () => void;
}

type LogTab = 'messages' | 'tasks' | 'assignments' | 'errors';

export function MessageFlowLogPanel({
  store,
  onResetRecords,
}: MessageFlowLogPanelProps) {
  const [activeTab, setActiveTab] = useState<LogTab>('messages');

  return (
    <section className="border border-neutral-500 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-300 pb-2">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">
            3. AI 응답 확인 및 공용 저장소 작업 기록
          </h2>
          <div className="text-[11px] text-neutral-600">
            마지막 저장 시각: {new Date(store.lastSavedAt).toLocaleString('ko-KR')} |
            명령 {store.commands.length}건 | 작업 {store.tasks.length}건 |
            메시지 {store.messages.length}건 | 오류 {store.errors.length}건
          </div>
        </div>
        <button
          type="button"
          onClick={onResetRecords}
          className="border border-neutral-500 bg-white px-2.5 py-1 text-xs hover:bg-neutral-100"
        >
          공용 기록 초기화
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 border-b border-neutral-300 pb-2">
        {(
          [
            ['messages', `메시지·응답 흐름 (${store.messages.length})`],
            ['tasks', `작업 상태 (${store.tasks.length})`],
            ['assignments', `업무 배정 기록 (${store.assignments.length})`],
            ['errors', `오류 기록 (${store.errors.length})`],
          ] as Array<[LogTab, string]>
        ).map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`border px-2.5 py-1 text-xs ${
              activeTab === tabId
                ? 'border-neutral-900 bg-neutral-900 font-semibold text-white'
                : 'border-neutral-400 bg-neutral-50 text-neutral-800 hover:bg-neutral-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-2 max-h-96 overflow-y-auto border border-neutral-300 bg-neutral-50 p-2">
        {activeTab === 'messages' && (
          <div className="space-y-2">
            {store.messages.length === 0 ? (
              <div className="p-3 text-xs text-neutral-600">
                아직 기록된 명령 또는 AI 응답 메시지가 없습니다.
              </div>
            ) : (
              [...store.messages].reverse().map((msg) => (
                <div
                  key={msg.id}
                  className={`border p-2 text-xs ${
                    msg.messageType === 'ERROR' || msg.messageType === 'BLOCKED'
                      ? 'border-red-400 bg-red-50'
                      : msg.messageType === 'INTER_AI_HANDOFF' ||
                          msg.messageType === 'DELEGATION_PLAN'
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-neutral-300 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-1 font-mono text-[11px]">
                    <span>
                      <strong>{msg.fromId}</strong> &rarr; <strong>{msg.toId}</strong>{' '}
                      [{msg.messageType}] (hop: {msg.hopCount})
                    </span>
                    <span className="text-neutral-600">
                      {new Date(msg.timestamp).toLocaleTimeString('ko-KR')} |{' '}
                      {msg.taskId}
                    </span>
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap leading-relaxed text-neutral-900">
                    {msg.content}
                  </div>
                  {msg.structuredPayload && (
                    <pre className="mt-1.5 overflow-x-auto border border-neutral-300 bg-neutral-100 p-1.5 font-mono text-[11px] text-neutral-800">
                      {JSON.stringify(msg.structuredPayload, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="space-y-2">
            {store.tasks.length === 0 ? (
              <div className="p-3 text-xs text-neutral-600">
                등록된 작업이 없습니다.
              </div>
            ) : (
              store.tasks.map((task) => (
                <div
                  key={task.id}
                  className="border border-neutral-300 bg-white p-2 text-xs"
                >
                  <div className="flex flex-wrap justify-between font-mono text-[11px]">
                    <span>
                      <strong>{task.id}</strong> | 상태: <strong>{task.status}</strong>{' '}
                      | 통제자: {task.centralLeadAtCreation} | 호출 {task.totalAiCalls}/
                      {task.maxHops}
                    </span>
                    <span>{new Date(task.updatedAt).toLocaleString('ko-KR')}</span>
                  </div>
                  <div className="mt-1 font-semibold">{task.commandText}</div>
                  <div className="mt-1 text-neutral-700">
                    결과 요약: {task.finalSummary}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'assignments' && (
          <div className="space-y-2">
            {store.assignments.length === 0 ? (
              <div className="p-3 text-xs text-neutral-600">
                업무 배정 기록이 없습니다.
              </div>
            ) : (
              store.assignments.map((asg) => (
                <div
                  key={asg.id}
                  className="border border-neutral-300 bg-white p-2 text-xs"
                >
                  <div className="flex flex-wrap justify-between font-mono text-[11px]">
                    <span>
                      {asg.assignedBy} &rarr; {asg.targetAiId} ({asg.targetDepartment})
                      | 상태: <strong>{asg.status}</strong>
                    </span>
                    <span>{new Date(asg.updatedAt).toLocaleTimeString('ko-KR')}</span>
                  </div>
                  <div className="mt-1">지시: {asg.instruction}</div>
                  {asg.reason && (
                    <div className="mt-1 text-red-800">사유: {asg.reason}</div>
                  )}
                  {asg.resultSummary && (
                    <div className="mt-1 text-neutral-700">
                      결과: {asg.resultSummary}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="space-y-2">
            {store.errors.length === 0 ? (
              <div className="p-3 text-xs text-neutral-600">
                기록된 오류가 없습니다.
              </div>
            ) : (
              store.errors.map((err) => (
                <div
                  key={err.id}
                  className="border border-red-400 bg-red-50 p-2 text-xs text-red-950"
                >
                  <div className="flex justify-between font-mono text-[11px]">
                    <span>
                      [{err.code}] 서비스: {err.serviceId ?? 'CENTRAL_ENGINE'}
                    </span>
                    <span>{new Date(err.timestamp).toLocaleString('ko-KR')}</span>
                  </div>
                  <div className="mt-1">{err.message}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}

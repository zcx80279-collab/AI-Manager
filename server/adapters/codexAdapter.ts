import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
} from '../../src/types/controlCenter.ts';

const execFileAsync = promisify(execFile);

let sessionCallCount = 0;

async function checkCliExists(binary: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(cmd, [binary], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function probeCodexConnector(): Promise<ConnectorProbeResult> {
  const hasCodexCli = await checkCliExists('codex');
  const hasOpenAiKey = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0
  );
  const now = new Date().toISOString();

  return {
    serviceId: 'codex',
    connectionStatus: hasCodexCli ? '연결됨' : '미연결',
    activeChannel: hasCodexCli ? 'OpenAI Codex CLI (codex exec)' : null,
    officialMethods: [
      {
        method: 'OpenAI Codex CLI (@openai/codex)',
        type: 'CLI',
        authMode: 'Sign in with ChatGPT (구독) 또는 OPENAI_API_KEY',
        supportedInCurrentRuntime: true,
        availableNow: hasCodexCli,
        note: hasCodexCli
          ? '로컬 시스템에 codex CLI 감지됨'
          : '현재 실행 환경에 codex CLI가 설치되어 있지 않음',
      },
      {
        method: 'Codex MCP Server (codex mcp-server)',
        type: 'MCP',
        authMode: 'Codex CLI 인증 상속',
        supportedInCurrentRuntime: hasCodexCli,
        availableNow: hasCodexCli,
        note: '로컬/데스크톱 환경에서 MCP 서버 모드로 연결 가능',
      },
    ],
    subscriptionSupportNote:
      `ChatGPT Plus/Pro/Team/Enterprise 구독자는 로컬/데스크톱 환경에서 공식 Codex CLI("codex login")를 통해 구독 한도로 연결 가능합니다. ${hasOpenAiKey ? '서버 OPENAI_API_KEY가 감지되었으나 codex 바이너리가 없어 CLI 실행은 불가합니다.' : ''}`.trim(),
    requiresPaidApproval: true,
    reason: hasCodexCli
      ? 'codex CLI 바이너리 감지됨 (실행 시 사용자 승인 필요)'
      : 'codex CLI 바이너리 미설치 — 웹 미리보기 컨테이너에서는 미연결 상태',
    quota: {
      remainingQuotaLabel: '확인 불가 (Codex CLI 사전 잔여 한도 조회 미제공)',
      resetTimeLabel: '확인 불가',
      isExhausted: false,
      isApproachingLimit: false,
      source: 'not_exposed',
      sessionCallCount,
      lastUpdatedAt: null,
    },
    probedAt: now,
  };
}

export async function executeCodexConnector(
  req: ExecuteConnectorRequest
): Promise<ExecuteConnectorResponse> {
  const now = new Date().toISOString();
  if (!req.userApprovedExecution) {
    return {
      ok: false,
      serviceId: 'codex',
      channelUsed: null,
      text: '',
      errorCode: 'APPROVAL_REQUIRED',
      errorMessage: 'Codex CLI 실행 전 사용자 승인이 필요합니다.',
      executedAt: now,
    };
  }

  const hasCodexCli = await checkCliExists('codex');
  if (!hasCodexCli) {
    return {
      ok: false,
      serviceId: 'codex',
      channelUsed: null,
      text: '',
      errorCode: 'CLI_NOT_AVAILABLE',
      errorMessage: '현재 환경에 공식 codex CLI가 설치되어 있지 않아 실행할 수 없습니다.',
      executedAt: now,
    };
  }

  try {
    const contextHeader =
      req.contextMessages && req.contextMessages.length > 0
        ? `[이전 AI 전달 기록]\n${req.contextMessages
            .map((m) => `- ${m.from}: ${m.content}`)
            .join('\n')}\n\n`
        : '';

    const safePrompt = `${req.systemInstruction ? `[역할 지침]\n${req.systemInstruction}\n\n` : ''}${contextHeader}${req.prompt}`;
    const { stdout } = await execFileAsync(
      'codex',
      ['exec', '--skip-git-repo-check', safePrompt],
      {
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      }
    );

    sessionCallCount += 1;
    return {
      ok: true,
      serviceId: 'codex',
      channelUsed: 'OpenAI Codex CLI (codex exec)',
      text: stdout.trim(),
      quotaUpdate: {
        sessionCallCount,
        lastUpdatedAt: new Date().toISOString(),
      },
      executedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota');
    return {
      ok: false,
      serviceId: 'codex',
      channelUsed: 'OpenAI Codex CLI',
      text: '',
      errorCode: isQuota ? 'QUOTA_EXHAUSTED' : 'EXECUTION_FAILED',
      errorMessage: msg,
      executedAt: new Date().toISOString(),
    };
  }
}

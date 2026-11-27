import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import type {
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
} from '../../src/types/controlCenter.ts';

const execFileAsync = promisify(execFile);

let sessionCallCount = 0;
let lastExhausted = false;
let lastUpdatedAt: string | null = null;

async function checkCliExists(binary: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(cmd, [binary], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function probeGeminiConnector(): Promise<ConnectorProbeResult> {
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  const hasGeminiCli = await checkCliExists('gemini');
  const now = new Date().toISOString();

  const connected = hasApiKey || hasGeminiCli;
  const activeChannel = hasApiKey
    ? '@google/genai SDK (Server Env: GEMINI_API_KEY)'
    : hasGeminiCli
      ? 'Gemini CLI (gemini)'
      : null;

  return {
    serviceId: 'gemini',
    connectionStatus: connected ? '연결됨' : '미연결',
    activeChannel,
    officialMethods: [
      {
        method: '@google/genai TypeScript SDK',
        type: 'SDK',
        authMode: 'GEMINI_API_KEY (서버 환경변수)',
        supportedInCurrentRuntime: true,
        availableNow: hasApiKey,
        note: hasApiKey
          ? '서버 환경변수 GEMINI_API_KEY 감지됨 (gemini-4-hydrogen 사용 가능)'
          : 'GEMINI_API_KEY 환경변수가 설정되지 않음',
      },
      {
        method: 'Gemini CLI (@google/gemini-cli)',
        type: 'CLI',
        authMode: 'Google 로그인(구독/Code Assist) 또는 GEMINI_API_KEY',
        supportedInCurrentRuntime: process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux',
        availableNow: hasGeminiCli,
        note: hasGeminiCli
          ? '로컬 시스템에 gemini CLI 바이너리가 감지됨'
          : '현재 실행 환경에 gemini CLI 바이너리가 설치되어 있지 않음',
      },
      {
        method: 'Gemini CLI MCP Client',
        type: 'MCP',
        authMode: '.gemini/settings.json 로컬 설정',
        supportedInCurrentRuntime: hasGeminiCli,
        availableNow: hasGeminiCli,
        note: 'CLI 설치 환경에서 외부 도구 MCP 서버 연동 지원',
      },
    ],
    subscriptionSupportNote:
      'Google AI Pro/Ultra 및 Gemini Code Assist 구독 인증은 공식 Gemini CLI의 "Login with Google" OAuth를 통해 로컬/데스크톱 환경에서 공식 지원됩니다. 웹 미리보기에서는 서버 GEMINI_API_KEY 기반 SDK만 동작합니다.',
    requiresPaidApproval: true,
    reason: connected
      ? `공식 경로 확인됨 (${activeChannel})`
      : 'GEMINI_API_KEY 미설정 및 gemini CLI 미설치로 실제 연결 불가',
    quota: {
      remainingQuotaLabel: lastExhausted
        ? '0 (API 429 RESOURCE_EXHAUSTED 감지)'
        : '확인 불가 (공식 API 사전 한도 조회 미제공)',
      resetTimeLabel: '확인 불가 (공식 API 초기화 시간 조회 미제공)',
      isExhausted: lastExhausted,
      isApproachingLimit: false,
      source: lastExhausted ? 'error_429' : 'not_exposed',
      sessionCallCount,
      lastUpdatedAt,
    },
    probedAt: now,
  };
}

export async function executeGeminiConnector(
  req: ExecuteConnectorRequest
): Promise<ExecuteConnectorResponse> {
  const now = new Date().toISOString();
  if (!req.userApprovedExecution) {
    return {
      ok: false,
      serviceId: 'gemini',
      channelUsed: null,
      text: '',
      errorCode: 'APPROVAL_REQUIRED',
      errorMessage: '외부 API/CLI 실행 전 사용자 승인이 필요합니다.',
      executedAt: now,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      serviceId: 'gemini',
      channelUsed: null,
      text: '',
      errorCode: 'NOT_CONNECTED',
      errorMessage: 'GEMINI_API_KEY가 설정되어 있지 않아 실제 Gemini 호출을 수행할 수 없습니다.',
      executedAt: now,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contextHeader =
      req.contextMessages && req.contextMessages.length > 0
        ? `[이전 AI 전달 기록]\n${req.contextMessages
            .map((m) => `- ${m.from}: ${m.content}`)
            .join('\n')}\n\n`
        : '';

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `${contextHeader}${req.prompt}`,
      config: req.systemInstruction
        ? { systemInstruction: req.systemInstruction }
        : undefined,
    });

    sessionCallCount += 1;
    lastExhausted = false;
    lastUpdatedAt = new Date().toISOString();

    return {
      ok: true,
      serviceId: 'gemini',
      channelUsed: '@google/genai SDK (gemini-4-hydrogen)',
      text: response.text ?? '',
      quotaUpdate: {
        remainingQuotaLabel: '확인 불가 (공식 API 사전 한도 조회 미제공)',
        resetTimeLabel: '확인 불가',
        isExhausted: false,
        source: 'not_exposed',
        sessionCallCount,
        lastUpdatedAt,
      },
      executedAt: lastUpdatedAt,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota =
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('429') ||
      msg.toLowerCase().includes('quota');

    if (isQuota) {
      lastExhausted = true;
      lastUpdatedAt = new Date().toISOString();
    }

    return {
      ok: false,
      serviceId: 'gemini',
      channelUsed: '@google/genai SDK (gemini-4-hydrogen)',
      text: '',
      quotaUpdate: isQuota
        ? {
            remainingQuotaLabel: '0 (429 RESOURCE_EXHAUSTED)',
            resetTimeLabel: '확인 불가',
            isExhausted: true,
            source: 'error_429',
            sessionCallCount,
            lastUpdatedAt,
          }
        : undefined,
      errorCode: isQuota ? 'QUOTA_EXHAUSTED' : 'EXECUTION_FAILED',
      errorMessage: msg,
      executedAt: new Date().toISOString(),
    };
  }
}

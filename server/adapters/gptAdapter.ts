import type {
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
  QuotaInfo,
} from '../../src/types/controlCenter.ts';
import { safeServerLog, sanitizeUserError } from '../security/errorSanitizer.ts';

let sessionCallCount = 0;
let lastQuota: QuotaInfo = {
  remainingQuotaLabel: '확인 불가 (실제 API 응답 헤더 수신 전)',
  resetTimeLabel: '확인 불가',
  isExhausted: false,
  isApproachingLimit: false,
  source: 'not_exposed',
  sessionCallCount: 0,
  lastUpdatedAt: null,
};

export async function probeGptConnector(): Promise<ConnectorProbeResult> {
  const hasOpenAiKey = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0
  );
  const now = new Date().toISOString();

  return {
    serviceId: 'gpt',
    connectionStatus: hasOpenAiKey ? '연결됨' : '미연결',
    activeChannel: hasOpenAiKey ? 'OpenAI Official REST API (OPENAI_API_KEY)' : null,
    officialMethods: [
      {
        method: 'OpenAI Official REST API (/v1/chat/completions)',
        type: 'REST_API',
        authMode: 'OPENAI_API_KEY (종량제 유료 API)',
        supportedInCurrentRuntime: true,
        availableNow: hasOpenAiKey,
        note: hasOpenAiKey
          ? '서버 환경변수 OPENAI_API_KEY 감지됨 (실제 호출 시 사용자 승인 필요)'
          : 'OPENAI_API_KEY 환경변수가 설정되지 않음',
      },
      {
        method: 'ChatGPT Plus/Pro 웹 구독 세션',
        type: 'REST_API',
        authMode: '개인 웹 로그인 세션',
        supportedInCurrentRuntime: false,
        availableNow: false,
        note: '공식 외부 제어 API 미제공 (비공식 세션 탈취/우회 금지 원칙에 따라 미지원)',
      },
    ],
    subscriptionSupportNote:
      'ChatGPT 웹 구독(Plus/Pro)은 브라우저 세션 기반 외부 제어용 공식 API를 제공하지 않습니다. 공식 구독 인증 연계는 Codex CLI의 "Sign in with ChatGPT" 경로에서만 지원됩니다.',
    requiresPaidApproval: true,
    reason: hasOpenAiKey
      ? 'OPENAI_API_KEY가 서버 환경변수에 설정되어 공식 REST API 연결 가능'
      : 'OPENAI_API_KEY 미설정 — 비공식 ChatGPT 웹 세션 우회 불가로 미연결 상태 유지',
    quota: {
      ...lastQuota,
      sessionCallCount,
    },
    probedAt: now,
  };
}

export async function executeGptConnector(
  req: ExecuteConnectorRequest
): Promise<ExecuteConnectorResponse> {
  const now = new Date().toISOString();
  if (!req.userApprovedExecution) {
    return {
      ok: false,
      serviceId: 'gpt',
      channelUsed: null,
      text: '',
      errorCode: 'APPROVAL_REQUIRED',
      errorMessage: '유료 OpenAI API 실행 전 사용자 승인이 필요합니다.',
      executedAt: now,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      serviceId: 'gpt',
      channelUsed: null,
      text: '',
      errorCode: 'NOT_CONNECTED',
      errorMessage: 'OPENAI_API_KEY가 설정되어 있지 않아 실제 GPT API 호출을 수행할 수 없습니다.',
      executedAt: now,
    };
  }

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (req.systemInstruction) {
      messages.push({ role: 'system', content: req.systemInstruction });
    }
    const contextHeader =
      req.contextMessages && req.contextMessages.length > 0
        ? `[이전 AI 전달 기록]\n${req.contextMessages
            .map((m) => `- ${m.from}: ${m.content}`)
            .join('\n')}\n\n`
        : '';
    messages.push({ role: 'user', content: `${contextHeader}${req.prompt}` });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
      }),
    });

    const remReq = response.headers.get('x-ratelimit-remaining-requests');
    const remTok = response.headers.get('x-ratelimit-remaining-tokens');
    const resetReq = response.headers.get('x-ratelimit-reset-requests');
    const resetTok = response.headers.get('x-ratelimit-reset-tokens');

    const hasHeaders = Boolean(remReq || remTok);
    const remainingNum = remReq ? Number(remReq) : null;
    const isApproaching = remainingNum !== null && !Number.isNaN(remainingNum) && remainingNum <= 3;

    if (!response.ok) {
      const errorBody = await response.text();
      const isQuota = response.status === 429 && errorBody.includes('insufficient_quota');
      const isRate = response.status === 429;
      if (isQuota) {
        lastQuota = {
          remainingQuotaLabel: '0 (insufficient_quota)',
          resetTimeLabel: resetReq ?? resetTok ?? '확인 불가',
          isExhausted: true,
          isApproachingLimit: true,
          source: 'error_429',
          sessionCallCount,
          lastUpdatedAt: new Date().toISOString(),
        };
      }
      safeServerLog('gptAdapter/http', `HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
      return {
        ok: false,
        serviceId: 'gpt',
        channelUsed: 'OpenAI REST API (gpt-4o-mini)',
        text: '',
        quotaUpdate: isQuota ? lastQuota : undefined,
        errorCode: isQuota ? 'QUOTA_EXHAUSTED' : isRate ? 'RATE_LIMITED' : 'EXECUTION_FAILED',
        errorMessage: isQuota
          ? sanitizeUserError('OpenAI API 사용 한도가 소진되었습니다.', response.status)
          : isRate
            ? sanitizeUserError('OpenAI API 요청 한도를 초과했습니다.', response.status)
            : sanitizeUserError('OpenAI API 요청 처리에 실패했습니다.', response.status),
        executedAt: new Date().toISOString(),
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    sessionCallCount += 1;
    const executedAt = new Date().toISOString();

    lastQuota = {
      remainingQuotaLabel: hasHeaders
        ? `요청 ${remReq ?? '?'} / 토큰 ${remTok ?? '?'}`
        : '확인 불가 (응답 헤더 미포함)',
      resetTimeLabel: resetReq || resetTok ? `요청 ${resetReq ?? '-'} / 토큰 ${resetTok ?? '-'}` : '확인 불가',
      isExhausted: false,
      isApproachingLimit: isApproaching,
      source: hasHeaders ? 'http_headers' : 'not_exposed',
      sessionCallCount,
      lastUpdatedAt: executedAt,
    };

    return {
      ok: true,
      serviceId: 'gpt',
      channelUsed: 'OpenAI REST API (gpt-4o-mini)',
      text: data.choices?.[0]?.message?.content ?? '',
      quotaUpdate: lastQuota,
      executedAt,
    };
  } catch (err: unknown) {
    safeServerLog('gptAdapter/execute', err);
    return {
      ok: false,
      serviceId: 'gpt',
      channelUsed: 'OpenAI REST API',
      text: '',
      errorCode: 'EXECUTION_FAILED',
      errorMessage: sanitizeUserError('OpenAI API 연결 중 오류가 발생했습니다.'),
      executedAt: new Date().toISOString(),
    };
  }
}

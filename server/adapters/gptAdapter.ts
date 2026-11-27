import fs from 'node:fs';
import path from 'node:path';
import type { ChatGPTClient, SessionState } from '../../vendor/siwc-local/src/types.ts';
import type { ConnectorProbeResult, ExecuteConnectorRequest, ExecuteConnectorResponse, QuotaInfo } from '../../src/types/controlCenter.ts';

let client: ChatGPTClient | null = null;
let sessionCallCount = 0;
let exhausted = false;
let selectedModel: string | null = null;
let quotaStatePath: string | null = null;
const quota = (): QuotaInfo => ({ remainingQuotaLabel: '확인 불가', resetTimeLabel: '확인 불가', isExhausted: exhausted, isApproachingLimit: false, source: exhausted ? 'error_429' : 'not_exposed', sessionCallCount, lastUpdatedAt: null });

export function setGptClient(value: ChatGPTClient, statePath: string): void {
  client = value;
  quotaStatePath = statePath;
  try {
    exhausted = JSON.parse(fs.readFileSync(statePath, 'utf8')).blocked === true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function resumeGptAfterLimit(): void {
  if (!quotaStatePath) throw new Error('GPT 한도 상태 저장소가 준비되지 않았습니다.');
  fs.mkdirSync(path.dirname(quotaStatePath), { recursive: true });
  fs.writeFileSync(quotaStatePath, JSON.stringify({ blocked: false }), 'utf8');
  exhausted = false;
}
export async function getGptSession(): Promise<SessionState> { return client ? client.getSession() : { status: 'disconnected', sharing: false }; }
export async function signInGpt(): Promise<SessionState> {
  if (!client) throw new Error('ChatGPT 로그인은 Windows 데스크톱 앱에서만 사용할 수 있습니다.');
  const session = await client.signIn();
  selectedModel = null;
  return session;
}
export async function signOutGpt(): Promise<SessionState> {
  if (!client) throw new Error('ChatGPT 연결이 초기화되지 않았습니다.');
  await client.disconnect();
  selectedModel = null;
  return client.getSession();
}

export async function probeGptConnector(): Promise<ConnectorProbeResult> {
  let session: SessionState;
  try { session = await getGptSession(); }
  catch { session = { status: 'reauth_required', sharing: false }; }
  let authError: string | null = null;
  if (session.status === 'connected' && session.sharing && client) {
    try {
      const models = await client.listModels();
      selectedModel = models[0]?.slug ?? null;
      if (!selectedModel) authError = '사용 가능한 ChatGPT 모델이 없습니다.';
    } catch (error) {
      authError = error instanceof Error ? error.message : 'ChatGPT 인증 확인 실패';
    }
  }
  const connected = session.status === 'connected' && session.sharing && !authError;
  return {
    serviceId: 'gpt', connectionStatus: connected ? '연결됨' : authError || session.status === 'reauth_required' ? '오류' : '미연결',
    activeChannel: connected ? 'Sign in with ChatGPT (Responses API)' : null,
    officialMethods: [{ method: 'Sign in with ChatGPT / Responses API', type: 'SDK', authMode: 'ChatGPT 계정 OAuth 및 사용량 공유 동의', supportedInCurrentRuntime: Boolean(client), availableNow: connected, note: client ? `인증: ${session.status}, 사용량 공유: ${session.sharing ? '허용' : '미허용'}` : '데스크톱 앱에서 로그인 가능' }],
    subscriptionSupportNote: '적격 Plus/Pro 계정은 별도 API 키 없이 구독 사용량으로 지원 모델에 요청할 수 있습니다. 잔여량은 확인할 수 없습니다.',
    requiresPaidApproval: false,
    reason: authError ?? (exhausted ? 'ChatGPT 사용량 한도 도달: 추가 호출 중단' : session.status === 'connected' && !session.sharing ? '로그인됨. ChatGPT 사용량 공유 권한이 필요합니다.' : connected ? `ChatGPT 계정 인증됨${session.identity?.email ? ` (${session.identity.email})` : ''}` : session.status === 'reauth_required' ? '인증 갱신 실패: 재로그인 필요' : 'ChatGPT 계정 로그인 필요'),
    quota: quota(), probedAt: new Date().toISOString(),
  };
}

export async function executeGptConnector(req: ExecuteConnectorRequest): Promise<ExecuteConnectorResponse> {
  const failure = (code: NonNullable<ExecuteConnectorResponse['errorCode']>, message: string): ExecuteConnectorResponse => ({ ok: false, serviceId: 'gpt', channelUsed: null, text: '', errorCode: code, errorMessage: message, quotaUpdate: quota(), executedAt: new Date().toISOString() });
  if (!req.userApprovedExecution) return failure('APPROVAL_REQUIRED', 'GPT 실행 전 사용자 승인이 필요합니다.');
  if (!client) return failure('NOT_CONNECTED', 'ChatGPT 데스크톱 연결이 초기화되지 않았습니다.');
  if (exhausted) return failure('QUOTA_EXHAUSTED', 'ChatGPT 사용량 한도에 도달해 호출을 중단했습니다.');
  try {
    const session = await client.getSession();
    if (session.status !== 'connected' || !session.sharing) return failure('NOT_CONNECTED', 'ChatGPT 로그인과 사용량 공유 동의가 필요합니다.');
    if (!selectedModel) {
      const models = await client.listModels();
      selectedModel = models[0]?.slug ?? null;
    }
    if (!selectedModel) return failure('EXECUTION_FAILED', '이 계정에서 사용할 수 있는 모델을 찾지 못했습니다.');
    const context = req.contextMessages?.length ? `[이전 AI 전달 기록]\n${req.contextMessages.map(m => `- ${m.from}: ${m.content}`).join('\n')}\n\n` : '';
    const result = await client.streamResponse({ model: selectedModel, input: `${context}${req.prompt}`, instructions: req.systemInstruction });
    sessionCallCount++;
    return { ok: true, serviceId: 'gpt', channelUsed: `ChatGPT plan / ${selectedModel}`, text: result.text, quotaUpdate: quota(), executedAt: new Date().toISOString() };
  } catch (error: unknown) {
    const details = error as { code?: string; message?: string; status?: number };
    const hitLimit = details.code === 'subscription_sharing_usage_limit_exceeded';
    if (hitLimit) {
      exhausted = true;
      if (quotaStatePath) {
        try {
          fs.mkdirSync(path.dirname(quotaStatePath), { recursive: true });
          fs.writeFileSync(quotaStatePath, JSON.stringify({ blocked: true }), 'utf8');
        } catch {
          // Keep the current process blocked even if the disk is unavailable.
        }
      }
    }
    return failure(hitLimit ? 'QUOTA_EXHAUSTED' : details.status === 429 ? 'RATE_LIMITED' : 'EXECUTION_FAILED', details.message ?? 'ChatGPT 요청 실패');
  }
}

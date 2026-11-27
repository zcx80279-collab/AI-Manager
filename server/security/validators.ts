import type {
  AIServiceId,
  ExecuteConnectorRequest,
  SharedControlStore,
} from '../../src/types/controlCenter.ts';

export const ALLOWED_SERVICES = new Set<AIServiceId>([
  'gpt',
  'gemini',
  'codex',
  'antigravity',
]);

export const MAX_PROMPT_LENGTH = 20_000;
export const MAX_SYSTEM_INSTRUCTION_LENGTH = 10_000;
export const MAX_CONTEXT_MESSAGES = 12;
export const MAX_CONTEXT_MESSAGE_LENGTH = 8_000;
export const MAX_STORE_BYTES = 2 * 1024 * 1024;

export function validateExecuteConnectorRequest(
  raw: unknown,
  forcedServiceId?: AIServiceId
): { ok: true; payload: ExecuteConnectorRequest } | { ok: false; errorMessage: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorMessage: '유효한 요청 형식이 필요합니다.' };
  }

  const body = raw as Partial<ExecuteConnectorRequest>;
  const serviceId = (forcedServiceId ?? body.serviceId) as AIServiceId | undefined;
  if (!serviceId || !ALLOWED_SERVICES.has(serviceId)) {
    return { ok: false, errorMessage: '허용되지 않은 AI 서비스 ID입니다.' };
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return { ok: false, errorMessage: '유효한 명령(prompt)이 필요합니다.' };
  }

  if (body.prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      errorMessage: `명령 길이가 허용 한도(${MAX_PROMPT_LENGTH.toLocaleString()}자)를 초과했습니다.`,
    };
  }

  if (
    body.systemInstruction !== undefined &&
    (typeof body.systemInstruction !== 'string' ||
      body.systemInstruction.length > MAX_SYSTEM_INSTRUCTION_LENGTH)
  ) {
    return {
      ok: false,
      errorMessage: '시스템 지침 형식이 올바르지 않거나 허용 길이를 초과했습니다.',
    };
  }

  let contextMessages: Array<{ from: string; content: string }> | undefined;
  if (body.contextMessages !== undefined) {
    if (!Array.isArray(body.contextMessages)) {
      return { ok: false, errorMessage: '컨텍스트 메시지 형식이 올바르지 않습니다.' };
    }
    contextMessages = body.contextMessages
      .filter(
        (m): m is { from: string; content: string } =>
          Boolean(m) &&
          typeof m === 'object' &&
          typeof m.from === 'string' &&
          typeof m.content === 'string' &&
          m.from.length <= 200 &&
          m.content.length <= MAX_CONTEXT_MESSAGE_LENGTH
      )
      .slice(-MAX_CONTEXT_MESSAGES);
  }

  return {
    ok: true,
    payload: {
      serviceId,
      prompt: body.prompt,
      systemInstruction: body.systemInstruction,
      userApprovedExecution: body.userApprovedExecution === true,
      contextMessages,
    },
  };
}

export function validateSharedControlStore(
  raw: unknown
): { ok: true; store: SharedControlStore } | { ok: false; errorMessage: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorMessage: '공용 저장소 데이터 구조가 올바르지 않습니다.' };
  }

  const candidate = raw as Partial<SharedControlStore>;
  if (
    typeof candidate.version !== 'string' ||
    !Array.isArray(candidate.agents) ||
    !Array.isArray(candidate.commands) ||
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.assignments) ||
    !Array.isArray(candidate.messages) ||
    !Array.isArray(candidate.errors)
  ) {
    return { ok: false, errorMessage: '공용 저장소 필수 필드가 누락되었거나 형식이 잘못되었습니다.' };
  }

  const serializedSize = Buffer.byteLength(JSON.stringify(candidate), 'utf-8');
  if (serializedSize > MAX_STORE_BYTES) {
    return { ok: false, errorMessage: '공용 저장소 데이터가 최대 허용 크기(2MB)를 초과했습니다.' };
  }

  return { ok: true, store: candidate as SharedControlStore };
}

export function isAllowedElectronStartUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:') return false;
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function isAllowedIpcSender(
  senderFrameUrl: string | undefined,
  allowedDevOrigin: string | null,
  expectedFileUrl: string
): boolean {
  if (!senderFrameUrl) return false;
  try {
    const parsed = new URL(senderFrameUrl);
    if (allowedDevOrigin && parsed.origin === allowedDevOrigin) {
      return true;
    }
    if (parsed.protocol === 'file:') {
      return parsed.href.split('#')[0].split('?')[0].toLowerCase() === expectedFileUrl.toLowerCase();
    }
    return false;
  } catch {
    return false;
  }
}

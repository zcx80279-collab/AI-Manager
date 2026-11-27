import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ConnectorProbeResult,
  ExecuteConnectorRequest,
  ExecuteConnectorResponse,
} from '../../src/types/controlCenter.ts';

const execFileAsync = promisify(execFile);

let sessionCallCount = 0;

async function resolveAgyBinary(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(cmd, ['agy'], { timeout: 2000 });
    return 'agy';
  } catch {
    if (process.platform === 'win32') {
      const localAgy = path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
      if (fs.existsSync(localAgy)) {
        return localAgy;
      }
    }
    return null;
  }
}

function checkAntigravityMcpConfigExists(): boolean {
  try {
    const home = os.homedir();
    const globalCfg = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const legacyCfg = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
    return fs.existsSync(globalCfg) || fs.existsSync(legacyCfg);
  } catch {
    return false;
  }
}

export async function probeAntigravityConnector(): Promise<ConnectorProbeResult> {
  const agyBinary = await resolveAgyBinary();
  const hasAgyCli = Boolean(agyBinary);
  const hasMcpConfig = checkAntigravityMcpConfigExists();
  const now = new Date().toISOString();

  return {
    serviceId: 'antigravity',
    connectionStatus: hasAgyCli ? '연결됨' : '미연결',
    activeChannel: hasAgyCli ? 'Google Antigravity CLI (agy -p)' : null,
    officialMethods: [
      {
        method: 'Antigravity CLI (agy -p)',
        type: 'CLI',
        authMode: 'Google 계정 / 로컬 CLI 세션',
        supportedInCurrentRuntime: true,
        availableNow: hasAgyCli,
        note: hasAgyCli
          ? '로컬 시스템에 agy CLI 바이너리 감지됨 (비대화형 -p 실행 지원)'
          : '현재 실행 환경에 agy CLI 바이너리가 설치되어 있지 않음',
      },
      {
        method: 'Antigravity MCP (mcp_config.json)',
        type: 'MCP',
        authMode: '~/.gemini/config/mcp_config.json',
        supportedInCurrentRuntime: true,
        availableNow: hasMcpConfig,
        note: hasMcpConfig
          ? '로컬 MCP 설정 파일 감지됨 (IDE/CLI 에이전트 도구 연결용)'
          : 'mcp_config.json 미감지 (Antigravity IDE가 외부 제어용 REST API를 제공하지 않음)',
      },
    ],
    subscriptionSupportNote:
      'Google Antigravity는 공식 agy CLI("agy -p")를 통해 기존 로그인 계정과 한도로 비대화형 프롬프트 실행 및 결과 수신을 지원합니다.',
    requiresPaidApproval: false,
    reason: hasAgyCli
      ? 'Antigravity CLI(agy) 감지됨 (비대화형 -p 실행 가능, 실행 시 사용자 승인 필요)'
      : 'agy CLI 미감지 및 외부 제어용 공식 REST API 미제공으로 미연결 상태',
    quota: {
      remainingQuotaLabel: '확인 불가 (Antigravity 공식 잔여 한도 조회 API 미제공)',
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

export async function executeAntigravityConnector(
  req: ExecuteConnectorRequest
): Promise<ExecuteConnectorResponse> {
  const now = new Date().toISOString();
  if (!req.userApprovedExecution) {
    return {
      ok: false,
      serviceId: 'antigravity',
      channelUsed: null,
      text: '',
      errorCode: 'APPROVAL_REQUIRED',
      errorMessage: 'Antigravity CLI 실행 전 사용자 승인이 필요합니다.',
      executedAt: now,
    };
  }

  const agyBinary = await resolveAgyBinary();
  if (!agyBinary) {
    return {
      ok: false,
      serviceId: 'antigravity',
      channelUsed: null,
      text: '',
      errorCode: 'CLI_NOT_AVAILABLE',
      errorMessage:
        'Antigravity CLI(agy)가 현재 환경에 설치되어 있지 않으며, 외부 제어용 공식 REST API가 제공되지 않아 실행할 수 없습니다.',
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
    const { stdout } = await execFileAsync(agyBinary, ['-p', safePrompt], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });

    sessionCallCount += 1;
    return {
      ok: true,
      serviceId: 'antigravity',
      channelUsed: 'Google Antigravity CLI (agy -p)',
      text: stdout.trim(),
      quotaUpdate: {
        sessionCallCount,
        lastUpdatedAt: new Date().toISOString(),
      },
      executedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota =
      msg.includes('429') ||
      msg.toLowerCase().includes('rate limit') ||
      msg.toLowerCase().includes('quota');
    return {
      ok: false,
      serviceId: 'antigravity',
      channelUsed: 'Google Antigravity CLI (agy -p)',
      text: '',
      errorCode: isQuota ? 'QUOTA_EXHAUSTED' : 'EXECUTION_FAILED',
      errorMessage: msg,
      executedAt: new Date().toISOString(),
    };
  }
}

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

async function checkCliExists(binary: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(cmd, [binary], { timeout: 2000 });
    return true;
  } catch {
    return false;
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
  const hasAgyCli = await checkCliExists('agy');
  const hasMcpConfig = checkAntigravityMcpConfigExists();
  const now = new Date().toISOString();

  return {
    serviceId: 'antigravity',
    connectionStatus: hasAgyCli ? '연결됨' : '미연결',
    activeChannel: hasAgyCli ? 'Google Antigravity CLI (agy)' : null,
    officialMethods: [
      {
        method: 'Antigravity CLI (agy)',
        type: 'CLI',
        authMode: 'Google 계정 / 로컬 IDE 세션',
        supportedInCurrentRuntime: true,
        availableNow: hasAgyCli,
        note: hasAgyCli
          ? '로컬 시스템에 agy CLI 바이너리 감지됨'
          : '현재 실행 환경에 agy CLI 바이너리가 설치되어 있지 않음',
      },
      {
        method: 'Antigravity MCP (mcp_config.json)',
        type: 'MCP',
        authMode: '~/.gemini/config/mcp_config.json',
        supportedInCurrentRuntime: true,
        availableNow: hasMcpConfig,
        note: hasMcpConfig
          ? '로컬 MCP 설정 파일 감지됨 (외부 프롬프트 제어용 서버가 아닌 IDE 에이전트 도구 연결용)'
          : 'mcp_config.json 미감지 (Antigravity IDE가 외부 제어용 REST API를 제공하지 않음)',
      },
    ],
    subscriptionSupportNote:
      'Google Antigravity는 IDE 및 agy CLI 중심의 에이전트 환경으로, 외부 프로그램에서 직접 채팅 프롬프트를 주입하는 공식 공개 REST API를 제공하지 않습니다. 데스크톱 환경에서 agy CLI 또는 MCP 도구 연동 방식으로만 연계할 수 있습니다.',
    requiresPaidApproval: false,
    reason: hasAgyCli
      ? 'Antigravity CLI(agy) 감지됨 (로컬 실행 시 사용자 승인 필요)'
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

  const hasAgyCli = await checkCliExists('agy');
  if (!hasAgyCli) {
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

  return {
    ok: false,
    serviceId: 'antigravity',
    channelUsed: 'Antigravity CLI (agy)',
    text: '',
    errorCode: 'EXECUTION_FAILED',
    errorMessage:
      'agy CLI는 대화형 터미널/IDE 런처 중심이므로 검증되지 않은 비대화형 플래그 자동 실행을 차단했습니다. (확인되지 않은 연동 방식 미구현 원칙 준수)',
    executedAt: new Date().toISOString(),
  };
}

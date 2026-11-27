export type AIServiceId = 'gpt' | 'gemini' | 'codex' | 'antigravity';

export type DepartmentId = 'general_chat' | 'development';

export type Rank = '부장' | '팀장' | '신입';

export type ConnectionStatus = '연결됨' | '미연결' | '오류';

export type WorkStatus =
  | '미연결'
  | '근무 중'
  | '업무 진행 중'
  | '한도 임박'
  | '퇴근'
  | '오류';

export type RuntimeKind = 'web-preview' | 'electron-desktop';

export interface RuntimeInfo {
  runtimeKind: RuntimeKind;
  platform: string;
  desktopBridgeAvailable: boolean;
  serverApiAvailable: boolean;
  appVersion: string;
}

export interface OfficialMethodSpec {
  method: string;
  type: 'SDK' | 'REST_API' | 'CLI' | 'MCP';
  authMode: string;
  supportedInCurrentRuntime: boolean;
  availableNow: boolean;
  note: string;
}

export interface QuotaInfo {
  remainingQuotaLabel: string;
  resetTimeLabel: string;
  isExhausted: boolean;
  isApproachingLimit: boolean;
  source: 'not_exposed' | 'http_headers' | 'error_429' | 'cli_status';
  sessionCallCount: number;
  lastUpdatedAt: string | null;
}

export interface ConnectorProbeResult {
  serviceId: AIServiceId;
  connectionStatus: ConnectionStatus;
  activeChannel: string | null;
  officialMethods: OfficialMethodSpec[];
  subscriptionSupportNote: string;
  requiresPaidApproval: boolean;
  reason: string;
  quota: QuotaInfo;
  probedAt: string;
}

export interface AIAgentConfig {
  id: AIServiceId;
  name: string;
  department: DepartmentId;
  rank: Rank;
  isCentralLead: boolean;
  workStatus: WorkStatus;
  connectionStatus: ConnectionStatus;
  responsibilities: string[];
  probe: ConnectorProbeResult | null;
}

export interface DepartmentDefinition {
  id: DepartmentId;
  name: string;
  responsibilities: string[];
}

export type CommandTargetMode =
  | 'central_lead_auto'
  | 'broadcast_all'
  | 'department_general'
  | 'department_dev'
  | 'individual';

export type CommonMessageType =
  | 'USER_COMMAND'
  | 'DELEGATION_PLAN'
  | 'AI_RESPONSE'
  | 'INTER_AI_HANDOFF'
  | 'REVIEW'
  | 'BLOCKED'
  | 'ERROR'
  | 'SYSTEM';

export interface CommonAIMessage {
  id: string;
  taskId: string;
  fromId: 'USER' | 'CENTRAL_ENGINE' | AIServiceId;
  toId: 'ALL' | 'GENERAL_CHAT' | 'DEVELOPMENT' | 'CENTRAL_ENGINE' | AIServiceId;
  fromRank?: Rank;
  department?: DepartmentId;
  messageType: CommonMessageType;
  content: string;
  structuredPayload?: Record<string, unknown>;
  hopCount: number;
  timestamp: string;
}

export type TaskStatus =
  | 'QUEUED'
  | 'ANALYZING'
  | 'DELEGATED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'STOPPED'
  | 'ERROR';

export interface TaskAssignment {
  id: string;
  taskId: string;
  assignedBy: AIServiceId | 'USER';
  targetAiId: AIServiceId;
  targetDepartment: DepartmentId;
  instruction: string;
  status:
    | 'PENDING'
    | 'EXECUTING'
    | 'COMPLETED'
    | 'BLOCKED_DISCONNECTED'
    | 'BLOCKED_OFF_DUTY'
    | 'STOPPED'
    | 'ERROR';
  reason?: string;
  resultSummary?: string;
  updatedAt: string;
}

export interface CommandRecord {
  id: string;
  taskId: string;
  rawCommand: string;
  targetMode: CommandTargetMode;
  targetAiId?: AIServiceId;
  maxHops: number;
  approvedPaidExecution: boolean;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  commandText: string;
  targetMode: CommandTargetMode;
  targetAiId?: AIServiceId;
  centralLeadAtCreation: AIServiceId;
  status: TaskStatus;
  finalSummary: string;
  totalAiCalls: number;
  maxHops: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorRecord {
  id: string;
  taskId?: string;
  serviceId?: AIServiceId;
  code: string;
  message: string;
  timestamp: string;
}

export interface SharedControlStore {
  version: string;
  agents: AIAgentConfig[];
  commands: CommandRecord[];
  tasks: TaskRecord[];
  assignments: TaskAssignment[];
  messages: CommonAIMessage[];
  errors: ErrorRecord[];
  lastSavedAt: string;
}

export interface ExecuteConnectorRequest {
  serviceId: AIServiceId;
  prompt: string;
  systemInstruction?: string;
  userApprovedExecution: boolean;
  contextMessages?: Array<{
    from: string;
    content: string;
  }>;
}

export interface ExecuteConnectorResponse {
  ok: boolean;
  serviceId: AIServiceId;
  channelUsed: string | null;
  text: string;
  quotaUpdate?: Partial<QuotaInfo>;
  errorCode?:
    | 'NOT_CONNECTED'
    | 'APPROVAL_REQUIRED'
    | 'QUOTA_EXHAUSTED'
    | 'RATE_LIMITED'
    | 'AUTH_ERROR'
    | 'CLI_NOT_AVAILABLE'
    | 'ABORTED'
    | 'EXECUTION_FAILED';
  errorMessage?: string;
  executedAt: string;
}

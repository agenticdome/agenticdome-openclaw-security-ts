import crypto from 'node:crypto';
import AgentGuardClient, {
  AgentGuardError,
  AgentGuardHTTPError
} from 'agenticdome-sdk';

export type Dict = Record<string, any>;

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonemptyText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function ensureDict(name: string, value: unknown): Dict {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`'${name}' must be an object`);
  }
  return value as Dict;
}

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stableTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const ctor = (value as any)?.constructor?.name;
  return ctor ? ctor : typeof value;
}

function obfuscatedObjectIdentifier(value: unknown): string {
  const raw = `${stableTypeName(value)}:${Object.prototype.toString.call(value)}`;
  const ref = sha256(raw).slice(0, 16);
  return `<non_serializable_object type=${stableTypeName(value)} ref=${ref}>`;
}

function safeJsonable(
  value: unknown,
  depth = 0,
  maxDepth = 20,
  maxItems = 1000
): any {
  if (depth > maxDepth) return '<max_depth_exceeded>';

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return {
      __type__: 'bytes',
      length: value.length,
      sha256: sha256(value)
    };
  }

  if (Array.isArray(value)) {
    const out: any[] = [];
    for (let i = 0; i < Math.min(value.length, maxItems); i++) {
      out.push(safeJsonable(value[i], depth + 1, maxDepth, maxItems));
    }
    if (value.length > maxItems) {
      out.push(`<truncated: exceeded max_items=${maxItems}>`);
    }
    return out;
  }

  if (value instanceof Set) {
    const out: any[] = [];
    let idx = 0;
    for (const item of value) {
      if (idx >= maxItems) {
        out.push(`<truncated: exceeded max_items=${maxItems}>`);
        break;
      }
      out.push(safeJsonable(item, depth + 1, maxDepth, maxItems));
      idx += 1;
    }

    try {
      return out.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      );
    } catch {
      return out;
    }
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);

    if (proto !== Object.prototype && proto !== null) {
      return obfuscatedObjectIdentifier(value);
    }

    const out: Dict = {};
    const entries = Object.entries(value as Dict);

    for (let i = 0; i < Math.min(entries.length, maxItems); i++) {
      const [key, val] = entries[i];
      out[String(key)] = safeJsonable(val, depth + 1, maxDepth, maxItems);
    }

    if (entries.length > maxItems) {
      out['<truncated>'] = `exceeded max_items=${maxItems}`;
    }

    return out;
  }

  return obfuscatedObjectIdentifier(value);
}

function canonicalJson(value: unknown): string {
  const safeValue = safeJsonable(value);

  const sortObject = (v: any): any => {
    if (Array.isArray(v)) return v.map(sortObject);
    if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
      const out: Dict = {};
      for (const key of Object.keys(v).sort()) {
        out[key] = sortObject(v[key]);
      }
      return out;
    }
    return v;
  };

  return JSON.stringify(sortObject(safeValue));
}

function toolFingerprint(toolName: string, toolArgs: Dict): string {
  return sha256(
    canonicalJson({
      tool_name: toolName || '',
      tool_args: toolArgs || {}
    })
  );
}

export function safeResultToText(
  rawResult: unknown,
  options: { maxChars: number }
): string {
  let text: string;

  try {
    if (typeof rawResult === 'string') {
      text = rawResult;
    } else if (
      rawResult === null ||
      rawResult === undefined ||
      typeof rawResult === 'boolean' ||
      typeof rawResult === 'number'
    ) {
      text = JSON.stringify(rawResult);
    } else if (Buffer.isBuffer(rawResult)) {
      text = JSON.stringify({
        __type__: 'bytes',
        length: rawResult.length,
        sha256: sha256(rawResult)
      });
    } else if (
      Array.isArray(rawResult) ||
      rawResult instanceof Set ||
      (typeof rawResult === 'object' &&
        Object.getPrototypeOf(rawResult) === Object.prototype)
    ) {
      text = JSON.stringify(safeJsonable(rawResult), null, 2);
    } else {
      text = obfuscatedObjectIdentifier(rawResult);
    }
  } catch {
    try {
      text = obfuscatedObjectIdentifier(rawResult);
    } catch {
      text = '<non_serializable_object ref=unavailable>';
    }
  }

  if (options.maxChars > 0 && text.length > options.maxChars) {
    const digest = sha256(text);
    return (
      '[OUTPUT OMITTED BY AgenticDome OPENCLAW ADAPTER: ' +
      `serialized output exceeded max_chars=${options.maxChars}; ` +
      `length=${text.length}; sha256=${digest}]`
    );
  }

  return text;
}

export interface OpenClawFirewallConfig {
  apiBase: string;
  apiKey: string;
  tenantId: string;

  platform: string;
  timeoutS: number;
  failClosed: boolean;
  requireExplicitSessionId: boolean;

  defaultToolPlatform: string;

  redactPii: boolean;
  redactSecrets: boolean;
  blockOnSensitiveOutput: boolean;

  handoffTokenTtlS: number;

  sdkMaxRetries: number;
  retryMaxAttempts: number;
  retryInitialDelayS: number;
  retryMaxDelayS: number;

  outputSerializationMaxChars: number;
}

export const DEFAULT_CONFIG: OpenClawFirewallConfig = {
  apiBase: env('AGENTICDOME_API_BASE', env('AgenticDome_API_BASE')).replace(/\/+$/, ''),
  apiKey: env('AGENTICDOME_API_KEY', env('AgenticDome_API_KEY')),
  tenantId: env('AGENTICDOME_TENANT_ID', env('AgenticDome_TENANT_ID')),

  platform: env('AGENTICDOME_PLATFORM', env('AgenticDome_PLATFORM', 'openclaw')),
  timeoutS: envInt('AGENTICDOME_TIMEOUT_S', envInt('AgenticDome_TIMEOUT_S', 20)),
  failClosed: envBool('AGENTICDOME_FAIL_CLOSED', envBool('AgenticDome_FAIL_CLOSED', true)),
  requireExplicitSessionId: envBool(
    'AGENTICDOME_REQUIRE_SESSION_ID',
    envBool('AgenticDome_REQUIRE_SESSION_ID', true)
  ),

  defaultToolPlatform: env(
    'AGENTICDOME_DEFAULT_TOOL_PLATFORM',
    env('AgenticDome_DEFAULT_TOOL_PLATFORM', 'python')
  ),

  redactPii: envBool('AGENTICDOME_REDACT_PII', envBool('AgenticDome_REDACT_PII', true)),
  redactSecrets: envBool(
    'AGENTICDOME_REDACT_SECRETS',
    envBool('AgenticDome_REDACT_SECRETS', true)
  ),
  blockOnSensitiveOutput: envBool(
    'AGENTICDOME_BLOCK_ON_SENSITIVE_OUTPUT',
    envBool('AgenticDome_BLOCK_ON_SENSITIVE_OUTPUT', false)
  ),

  handoffTokenTtlS: envInt(
    'AGENTICDOME_HANDOFF_TOKEN_TTL_S',
    envInt('AgenticDome_HANDOFF_TOKEN_TTL_S', 900)
  ),

  sdkMaxRetries: envInt(
    'AGENTICDOME_SDK_MAX_RETRIES',
    envInt('AgenticDome_SDK_MAX_RETRIES', 3)
  ),
  retryMaxAttempts: envInt(
    'AGENTICDOME_RETRY_MAX_ATTEMPTS',
    envInt('AgenticDome_RETRY_MAX_ATTEMPTS', 1)
  ),
  retryInitialDelayS: envFloat(
    'AGENTICDOME_RETRY_INITIAL_DELAY_S',
    envFloat('AgenticDome_RETRY_INITIAL_DELAY_S', 0.25)
  ),
  retryMaxDelayS: envFloat(
    'AGENTICDOME_RETRY_MAX_DELAY_S',
    envFloat('AgenticDome_RETRY_MAX_DELAY_S', 2.0)
  ),

  outputSerializationMaxChars: envInt(
    'AGENTICDOME_OUTPUT_SERIALIZATION_MAX_CHARS',
    envInt('AgenticDome_OUTPUT_SERIALIZATION_MAX_CHARS', 200_000)
  )
};

export class OpenClawFirewallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawFirewallError';
  }
}

export class OpenClawExecutionDenied extends OpenClawFirewallError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawExecutionDenied';
  }
}

export interface DecisionTokenRecord {
  decisionToken: string;
  sourceAgentId: string;
  createdAt: number;
}

interface DecisionTokenStore {
  put(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
    record: DecisionTokenRecord;
    ttlS: number;
  }): void;

  get(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): DecisionTokenRecord | undefined;

  delete(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): void;

  pop(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): DecisionTokenRecord | undefined;
}

class InMemoryDecisionTokenStore implements DecisionTokenStore {
  private readonly tenantId: string;
  private readonly data = new Map<string, { expiresAt: number; record: DecisionTokenRecord }>();

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  private key(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): string {
    return [
      this.tenantId,
      args.sessionId,
      args.targetAgentId,
      toolFingerprint(args.toolName, args.toolArgs)
    ].join(':');
  }

  private cleanup(): void {
    const now = Date.now() / 1000;
    for (const [key, value] of this.data.entries()) {
      if (value.expiresAt <= now) {
        this.data.delete(key);
      }
    }
  }

  put(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
    record: DecisionTokenRecord;
    ttlS: number;
  }): void {
    this.cleanup();
    this.data.set(this.key(args), {
      expiresAt: Date.now() / 1000 + args.ttlS,
      record: args.record
    });
  }

  get(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): DecisionTokenRecord | undefined {
    this.cleanup();
    return this.data.get(this.key(args))?.record;
  }

  delete(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): void {
    this.data.delete(this.key(args));
  }

  pop(args: {
    sessionId: string;
    targetAgentId: string;
    toolName: string;
    toolArgs: Dict;
  }): DecisionTokenRecord | undefined {
    this.cleanup();
    const key = this.key(args);
    const entry = this.data.get(key);
    this.data.delete(key);
    return entry?.record;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenClawFirewall {
  private static readonly RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  public readonly config: OpenClawFirewallConfig;
  public readonly client: AgentGuardClient;
  private readonly tokenStore: DecisionTokenStore;

  constructor(config: Partial<OpenClawFirewallConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };

    if (!this.config.apiBase || !this.config.apiKey || !this.config.tenantId) {
      throw new Error(
        'AgenticDome firewall misconfigured. Set AGENTICDOME_API_BASE, AGENTICDOME_API_KEY, AGENTICDOME_TENANT_ID.'
      );
    }

    this.client = new AgentGuardClient(this.config.apiBase, {
      apiKey: this.config.apiKey,
      tenantId: this.config.tenantId,
      timeout: this.config.timeoutS,
      maxRetries: this.config.sdkMaxRetries
    });

    this.tokenStore = new InMemoryDecisionTokenStore(this.config.tenantId);
  }

  private requireSessionId(sessionId: string): void {
    if (this.config.requireExplicitSessionId && !String(sessionId || '').trim()) {
      throw new OpenClawExecutionDenied('Missing required explicit session_id.');
    }
  }

  private failOrRaise(message: string, cause?: unknown): void {
    if (this.config.failClosed) {
      const err = new OpenClawExecutionDenied(message);
      if (cause !== undefined) {
        (err as any).cause = cause;
      }
      throw err;
    }

    console.warn(`AgenticDome FAIL-OPEN: ${message}`);
  }

  private httpStatus(error: unknown): number | undefined {
    if (error instanceof AgentGuardHTTPError) {
      return error.statusCode;
    }

    const anyErr = error as any;
    const status =
      anyErr?.statusCode ??
      anyErr?.status ??
      anyErr?.code ??
      anyErr?.response?.statusCode ??
      anyErr?.response?.status;

    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private isRetryableException(error: unknown): boolean {
    if (error instanceof AgentGuardHTTPError) {
      const status = this.httpStatus(error);
      return status !== undefined && OpenClawFirewall.RETRYABLE_STATUS_CODES.has(status);
    }

    const text = `${(error as any)?.name || ''} ${(error as any)?.code || ''} ${errorMessage(error)}`.toLowerCase();

    return [
      'timeout',
      'connectionerror',
      'connecterror',
      'readtimeout',
      'networkerror',
      'temporarilyunavailable',
      'serviceunavailable',
      'econnreset',
      'econnrefused',
      'etimedout'
    ].some((marker) => text.includes(marker));
  }

  private async agentguardCall<T>(methodName: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = Math.max(1, Math.trunc(this.config.retryMaxAttempts));
    const baseDelay = Math.max(0, this.config.retryInitialDelayS);
    const maxDelay = Math.max(baseDelay, this.config.retryMaxDelayS);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const retryable = this.isRetryableException(error);
        const lastAttempt = attempt >= maxAttempts;

        if (!retryable || lastAttempt) {
          throw error;
        }

        const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
        const jitter = delay > 0 ? Math.random() * delay * 0.25 : 0;
        const waitMs = Math.round((delay + jitter) * 1000);

        console.warn(
          `AgenticDome transient client error; retrying method=${methodName} attempt=${attempt}/${maxAttempts} delay=${waitMs}ms error=${errorMessage(error)}`
        );

        await sleep(waitMs);
      }
    }

    throw new Error('unreachable');
  }

  private toolPlatform(toolPlatform: string | undefined, toolArgs: Dict): string {
    return String(
      toolPlatform ||
      toolArgs.tool_platform ||
      toolArgs.platform ||
      this.config.defaultToolPlatform
    );
  }

  private extractResult(payload: Dict): Dict {
    if (!payload || typeof payload !== 'object') return {};

    if (payload.error) {
      throw new OpenClawExecutionDenied(`AgenticDome JSON-RPC error: ${JSON.stringify(payload.error)}`);
    }

    const result = payload.result;
    return result && typeof result === 'object' ? result : payload;
  }

  private verdict(payload: Dict): string {
    const env = this.extractResult(payload);
    return String(env.verdict || env.decision || '').toUpperCase();
  }

  private reason(payload: Dict): string {
    const env = this.extractResult(payload);
    return String(env.reason || env.message || JSON.stringify(payload));
  }

  private mergedPolicyContext(args: {
    agentId: string;
    requestPurpose: string;
    policyContext?: Dict;
    extra?: Dict;
  }): Dict {
    const ctx: Dict = {
      ...(args.policyContext || {})
    };

    if (ctx.source_agent_id === undefined) {
      ctx.source_agent_id = args.agentId;
    }

    if (ctx.request_purpose === undefined) {
      ctx.request_purpose = args.requestPurpose;
    }

    if (ctx.platform === undefined) {
      ctx.platform = this.config.platform;
    }

    if (args.extra) {
      Object.assign(ctx, args.extra);
    }

    return ctx;
  }

  async screenPrompt(args: {
    text: string;
    agentId: string;
    sessionId: string;
    policyContext?: Dict;
  }): Promise<Dict> {
    this.requireSessionId(args.sessionId);

    const text = nonemptyText(args.text, '[empty prompt]');

    try {
      const response = await this.agentguardCall('guardrailValidate', () =>
        this.client.guardrailValidate({
          sessionId: args.sessionId,
          direction: 'input',
          text,
          agentId: args.agentId,
          platform: this.config.platform,
          sourcePlatform: this.config.platform,
          policyContext: this.mergedPolicyContext({
            agentId: args.agentId,
            requestPurpose: 'prompt_input',
            policyContext: args.policyContext
          })
        })
      );

      if (this.verdict(response) === 'BLOCKED') {
        throw new OpenClawExecutionDenied(`AgenticDome blocked prompt: ${this.reason(response)}`);
      }

      return response;
    } catch (error) {
      if (error instanceof OpenClawExecutionDenied) throw error;
      if (!(error instanceof AgentGuardError) && error instanceof Error && error.name === 'Error') {
        this.failOrRaise(`AgenticDome input screening error: ${errorMessage(error)}`, error);
        return {};
      }
      this.failOrRaise(`AgenticDome input screening error: ${errorMessage(error)}`, error);
      return {};
    }
  }

  async authorizeDirectSkill(args: {
    text: string;
    agentId: string;
    skillName: string;
    skillArgs: Dict;
    sessionId: string;
    toolPlatform?: string;
    policyContext?: Dict;
  }): Promise<Dict> {
    this.requireSessionId(args.sessionId);

    const skillArgs = ensureDict('skillArgs', args.skillArgs);
    const text = nonemptyText(
      args.text,
      `[OpenClaw] Agent ${args.agentId} executing ${args.skillName}`
    );
    const effectiveToolPlatform = this.toolPlatform(args.toolPlatform, skillArgs);

    try {
      const response = await this.agentguardCall('guardrailValidate', () =>
        this.client.guardrailValidate({
          sessionId: args.sessionId,
          direction: 'outbound',
          text,
          agentId: args.agentId,
          platform: this.config.platform,
          sourcePlatform: this.config.platform,
          toolPlatform: effectiveToolPlatform,
          toolName: args.skillName,
          toolArgs: skillArgs,
          policyContext: this.mergedPolicyContext({
            agentId: args.agentId,
            requestPurpose: 'skill_execution',
            policyContext: args.policyContext,
            extra: {
              tool_platform: effectiveToolPlatform
            }
          })
        })
      );

      if (this.verdict(response) === 'BLOCKED') {
        throw new OpenClawExecutionDenied(
          `AgenticDome blocked skill execution: ${this.reason(response)}`
        );
      }

      return response;
    } catch (error) {
      if (error instanceof OpenClawExecutionDenied) throw error;
      this.failOrRaise(`AgenticDome direct authorization error: ${errorMessage(error)}`, error);
      return {};
    }
  }

  async authorizeManagerHandoff(args: {
    text: string;
    managerAgentId: string;
    specialistAgentId: string;
    skillName: string;
    skillArgs: Dict;
    sessionId: string;
    toolPlatform?: string;
    policyContext?: Dict;
  }): Promise<Dict> {
    this.requireSessionId(args.sessionId);

    const skillArgs = ensureDict('skillArgs', args.skillArgs);
    const text = nonemptyText(
      args.text,
      `[OpenClaw] Manager ${args.managerAgentId} delegates ${args.skillName} to ${args.specialistAgentId}`
    );
    const effectiveToolPlatform = this.toolPlatform(args.toolPlatform, skillArgs);

    try {
      const response = await this.agentguardCall('a2aAuthorizeTool', () =>
        this.client.a2aAuthorizeTool({
          text,
          agentId: args.specialistAgentId,
          platform: this.config.platform,
          sourcePlatform: this.config.platform,
          toolPlatform: effectiveToolPlatform,
          toolName: args.skillName,
          toolArgs: skillArgs,
          sessionId: args.sessionId,
          direction: 'outbound',
          sourceAgentId: args.managerAgentId,
          policyContext: this.mergedPolicyContext({
            agentId: args.managerAgentId,
            requestPurpose: 'delegated_task',
            policyContext: args.policyContext,
            extra: {
              source_agent_id: args.managerAgentId,
              delegation_chain: [args.managerAgentId, args.specialistAgentId],
              tool_platform: effectiveToolPlatform
            }
          })
        })
      );

      const envelope = this.extractResult(response);

      if (this.verdict(envelope) !== 'ALLOWED') {
        throw new OpenClawExecutionDenied(
          `AgenticDome blocked delegation: ${this.reason(envelope)}`
        );
      }

      const decisionToken = String(envelope.decision_token || '');

      if (decisionToken) {
        this.tokenStore.put({
          sessionId: args.sessionId,
          targetAgentId: args.specialistAgentId,
          toolName: args.skillName,
          toolArgs: skillArgs,
          record: {
            decisionToken,
            sourceAgentId: args.managerAgentId,
            createdAt: Date.now() / 1000
          },
          ttlS: this.config.handoffTokenTtlS
        });
      }

      return envelope;
    } catch (error) {
      if (error instanceof OpenClawExecutionDenied) throw error;
      this.failOrRaise(`AgenticDome delegation authorization error: ${errorMessage(error)}`, error);
      return {};
    }
  }

  async verifySpecialistExecution(args: {
    specialistAgentId: string;
    skillName: string;
    skillArgs: Dict;
    sessionId: string;
    decisionToken?: string;
    sourceAgentId?: string;
  }): Promise<Dict> {
    this.requireSessionId(args.sessionId);

    const skillArgs = ensureDict('skillArgs', args.skillArgs);

    let token = args.decisionToken;
    let source = args.sourceAgentId;

    if (!token) {
      const pending = this.tokenStore.pop({
        sessionId: args.sessionId,
        targetAgentId: args.specialistAgentId,
        toolName: args.skillName,
        toolArgs: skillArgs
      });

      if (pending) {
        token = pending.decisionToken;
        source = pending.sourceAgentId;
      }
    }

    if (!token || !source) {
      throw new OpenClawExecutionDenied(
        'Missing AgenticDome delegation token or source agent id for specialist execution.'
      );
    }

    try {
      const response = await this.agentguardCall('a2aVerifyDecisionTokenRpc', () =>
        this.client.a2aVerifyDecisionTokenRpc(token!, {
          toolName: args.skillName,
          toolArgs: skillArgs,
          agentId: args.specialistAgentId,
          sourceAgentId: source,
          platform: this.config.platform,
          requireAllowed: true
        })
      );

      const result = this.extractResult(response);

      if (!Boolean(result.valid)) {
        throw new OpenClawExecutionDenied(
          `AgenticDome blocked delegated execution: ${result.reason || JSON.stringify(result)}`
        );
      }

      return result;
    } catch (error) {
      if (error instanceof OpenClawExecutionDenied) throw error;
      this.failOrRaise(`AgenticDome token verification error: ${errorMessage(error)}`, error);
      return {};
    }
  }

  async sanitizeOutput(args: {
    text: string;
    agentId: string;
    sessionId: string;
    policyContext?: Dict;
  }): Promise<string> {
    this.requireSessionId(args.sessionId);

    const safeText = nonemptyText(args.text, '[empty output]');

    try {
      const response = await this.agentguardCall('meshValidate', () =>
        this.client.meshValidate({
          agentId: args.agentId,
          sessionId: args.sessionId,
          direction: 'output',
          text: safeText,
          platform: this.config.platform,
          redactPii: this.config.redactPii,
          redactSecrets: this.config.redactSecrets,
          blockOnSensitiveOutput: this.config.blockOnSensitiveOutput,
          policyContext: this.mergedPolicyContext({
            agentId: args.agentId,
            requestPurpose: 'output_review',
            policyContext: args.policyContext,
            extra: {
              redact_pii: this.config.redactPii,
              redact_secrets: this.config.redactSecrets,
              block_on_sensitive_output: this.config.blockOnSensitiveOutput
            }
          })
        })
      );

      const envelope = this.extractResult(response);
      const verdict = this.verdict(envelope);

      const sanitizedText =
        envelope.text ??
        envelope.sanitized_text ??
        response.text ??
        response.sanitized_text;

      if (verdict === 'BLOCKED') {
        console.warn(
          `AgenticDome blocked output for agent=${args.agentId} reason=${this.reason(envelope)}`
        );
        return '[OUTPUT BLOCKED BY AgenticDome]';
      }

      if (sanitizedText !== undefined && sanitizedText !== null) {
        return String(sanitizedText);
      }

      return safeText;
    } catch (error) {
      if (error instanceof OpenClawExecutionDenied) throw error;
      this.failOrRaise(`AgenticDome mesh sanitization error: ${errorMessage(error)}`, error);
      return safeText;
    }
  }

  async protectedExecute(args: {
    agentId: string;
    skillName: string;
    skillFunc: (...args: any[]) => any | Promise<any>;
    skillArgs: Dict;
    sessionId: string;
    text: string;
    toolPlatform?: string;
    policyContext?: Dict;
    delegated?: boolean;
    decisionToken?: string;
    sourceAgentId?: string;
  }): Promise<string> {
    this.requireSessionId(args.sessionId);

    const skillArgs = ensureDict('skillArgs', args.skillArgs);

    if (args.delegated) {
      await this.verifySpecialistExecution({
        specialistAgentId: args.agentId,
        skillName: args.skillName,
        skillArgs,
        sessionId: args.sessionId,
        decisionToken: args.decisionToken,
        sourceAgentId: args.sourceAgentId
      });
    } else {
      await this.authorizeDirectSkill({
        text: args.text,
        agentId: args.agentId,
        skillName: args.skillName,
        skillArgs,
        sessionId: args.sessionId,
        toolPlatform: args.toolPlatform,
        policyContext: args.policyContext
      });
    }

    const rawResult = await args.skillFunc(...[], skillArgs);

    const resultText = safeResultToText(rawResult, {
      maxChars: this.config.outputSerializationMaxChars
    });

    return this.sanitizeOutput({
      text: resultText,
      agentId: args.agentId,
      sessionId: args.sessionId,
      policyContext: args.policyContext
    });
  }

  close(): void {
    try {
      this.client.close();
    } catch {
      // ignore
    }
  }
}

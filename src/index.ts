import { OpenClawFirewall, safeResultToText } from './firewall';

type OpenClawEventHandler = (event: any, ctx?: any) => any | Promise<any>;

interface OpenClawPluginApi {
  on(eventName: string, handler: OpenClawEventHandler): void;
}

interface OpenClawPluginEntry {
  id: string;
  name: string;
  description: string;
  configSchema?: Record<string, unknown>;
  register(api: OpenClawPluginApi): void | Promise<void>;
}

/**
 * Local compatibility helper.
 *
 * Real OpenClaw exposes definePluginEntry from @openclaw/plugin-sdk. The npm
 * package is workspace-private today, so this helper preserves the same entry
 * shape without forcing consumers to install OpenClaw internals.
 */
function definePluginEntry(entry: OpenClawPluginEntry): OpenClawPluginEntry {
  return entry;
}

function cleanInternalParams(params: Record<string, any>): {
  params: Record<string, any>;
  decisionToken?: string;
  sourceAgentId?: string;
} {
  const workingParams = { ...(params || {}) };

  const decisionToken = workingParams._decision_token;
  const sourceAgentId = workingParams._source_agent_id;

  delete workingParams._decision_token;
  delete workingParams._source_agent_id;

  return {
    params: workingParams,
    decisionToken,
    sourceAgentId,
  };
}

function shallowCloneObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, any>) };
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localOutputSerializationMaxChars(): number {
  return envInt(
    'AGENTICDOME_OUTPUT_SERIALIZATION_MAX_CHARS',
    envInt('AgenticDome_OUTPUT_SERIALIZATION_MAX_CHARS', 200_000)
  );
}

export function redactLocalText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, '[SECRET_REDACTED]')
    .replace(/\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g, '[SECRET_REDACTED]')
    .replace(/\b(?:api[_-]?key|token|password|secret)=\S+/gi, (match) => {
      const key = match.split('=')[0] || 'secret';
      return `${key}=[SECRET_REDACTED]`;
    })
    .replace(
      /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
      'Authorization: Bearer [SECRET_REDACTED]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [SECRET_REDACTED]');
}

function redactJsonableText(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') {
    return redactLocalText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonableText(item, maxChars));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (
      ['api_key', 'apikey', 'authorization', 'password', 'secret', 'token'].some((part) =>
        lowered.includes(part)
      )
    ) {
      out[key] = '[SECRET_REDACTED]';
      continue;
    }
    out[key] = redactJsonableText(item, maxChars);
  }

  const serialized = safeResultToText(out, { maxChars });
  return serialized.startsWith('[OUTPUT OMITTED BY AgenticDome OPENCLAW ADAPTER:')
    ? serialized
    : out;
}

export function redactOpenClawMessage(message: unknown, maxChars: number): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return message;
  }

  const msg = message as Record<string, unknown>;
  const next: Record<string, unknown> = { ...msg };

  if (Array.isArray(msg.content)) {
    next.content = msg.content.map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return part;
      }
      const contentPart = part as Record<string, unknown>;
      if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
        return {
          ...contentPart,
          text: redactLocalText(contentPart.text),
        };
      }
      return redactJsonableText(contentPart, maxChars);
    });
  } else if (typeof msg.content === 'string') {
    next.content = redactLocalText(msg.content);
  }

  if ('details' in msg) {
    next.details = redactJsonableText(msg.details, maxChars);
  }

  return next;
}

export default definePluginEntry({
  id: 'agenticdome-security',
  name: 'AgenticDome Shield',
  description:
    'Zero-trust prompt, tool, delegation, and transcript persistence security for OpenClaw runtimes.',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },

  register(api) {
    let firewall: OpenClawFirewall | undefined;

    const getFirewall = () => {
      firewall ??= new OpenClawFirewall();
      return firewall;
    };

    // 1. Prompt ingress scan
    api.on('before_agent_run', async (event: any, hookCtx?: any) => {
      try {
        const ctx = {
          ...shallowCloneObject(event?.ctx),
          ...shallowCloneObject(hookCtx),
        };

        await getFirewall().screenPrompt({
          text: String(event?.prompt || ''),
          agentId: String(ctx.agentId || ''),
          sessionId: String(ctx.sessionId || ''),
        });

        return { outcome: 'pass' };
      } catch (error: any) {
        return {
          outcome: 'block',
          reason: error?.message || 'Prompt blocked by AgenticDome policy',
          message: 'Prompt blocked by AgenticDome policy.',
          category: 'agenticdome_prompt_guardrail',
        };
      }
    });

    // 2. Security execution gateway
    api.on('before_tool_call', async (event: any, hookCtx?: any) => {
      try {
        const ctx = {
          ...shallowCloneObject(event?.ctx),
          ...shallowCloneObject(hookCtx),
        };
        const agentId = String(ctx.agentId || '');
        const sessionId = String(ctx.sessionId || '');
        const toolName = String(event?.toolName || '').trim();

        const {
          params: workingParams,
          decisionToken,
          sourceAgentId,
        } = cleanInternalParams(event?.params || {});

        const contextSourceAgentId = sourceAgentId || ctx.sourceAgentId;
        // Case A: Specialist delegated execution verification
        if (contextSourceAgentId || decisionToken) {
          await getFirewall().verifySpecialistExecution({
            specialistAgentId: agentId,
            skillName: toolName,
            skillArgs: workingParams,
            sessionId,
            decisionToken,
            sourceAgentId: contextSourceAgentId
              ? String(contextSourceAgentId)
              : undefined,
          });

          return {
            params: workingParams,
          };
        }

        // Case B: Manager handoff routing
        const handoffTools = [
          'route_to_agent',
          'delegate_task',
          'handoff_to_agent',
          'transfer_to_agent',
        ];

        if (handoffTools.includes(toolName)) {
          const targetId = workingParams.target_agent_id;
          const targetTool = workingParams.target_tool_name;

          const rawTargetArgs =
            workingParams.target_tool_args || workingParams.skill_args || {};
          const targetArgs = shallowCloneObject(rawTargetArgs);

          const authzEnvelope = await getFirewall().authorizeManagerHandoff({
            text: `Manager ${agentId} delegating to ${targetId}`,
            managerAgentId: agentId,
            specialistAgentId: String(targetId),
            skillName: String(targetTool),
            skillArgs: targetArgs,
            sessionId,
          });

          if (authzEnvelope.decision_token) {
            workingParams._decision_token = authzEnvelope.decision_token;
            workingParams._source_agent_id = agentId;

            targetArgs._decision_token = authzEnvelope.decision_token;
            targetArgs._source_agent_id = agentId;

            if (
              'target_tool_args' in workingParams ||
              !('skill_args' in workingParams)
            ) {
              workingParams.target_tool_args = targetArgs;
            } else {
              workingParams.skill_args = targetArgs;
            }
          }

          return {
            params: workingParams,
          };
        }

        // Case C: Direct tool execution
        await getFirewall().authorizeDirectSkill({
          text: `Direct execution of ${toolName}`,
          agentId,
          skillName: toolName,
          skillArgs: workingParams,
          sessionId,
        });

        return {
          params: workingParams,
        };
      } catch (error: any) {
        return {
          block: true,
          blockReason:
            error?.message || 'Execution denied by AgenticDome policy',
        };
      }
    });

    // 3. Synchronous transcript persistence redaction.
    //
    // OpenClaw intentionally runs tool_result_persist synchronously in the
    // session hot path. Cloud DLP remains available through sanitizeOutput()
    // and protectedExecute(); this hook performs local no-network redaction
    // so the OpenClaw transcript contract is preserved.
    api.on('tool_result_persist', (event: any) => {
      if (!event?.message) {
        return undefined;
      }

      return {
        message: redactOpenClawMessage(
          event.message,
          localOutputSerializationMaxChars()
        ),
      };
    });
  },
});

export { OpenClawFirewall };

export {
  OpenClawExecutionDenied,
  OpenClawFirewallError,
  safeResultToText,
} from './firewall';

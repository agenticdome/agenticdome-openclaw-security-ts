import { OpenClawFirewall } from './firewall';

type OpenClawEventHandler = (event: any) => any | Promise<any>;

interface OpenClawPluginApi {
  on(eventName: string, handler: OpenClawEventHandler): void;
}

interface OpenClawPluginEntry {
  id: string;
  name: string;
  register(api: OpenClawPluginApi): void | Promise<void>;
}

/**
 * Local compatibility helper.
 *
 * Some OpenClaw runtimes provide definePluginEntry, but the npm package
 * openclaw-plugin-sdk is not publicly available. This local helper keeps
 * the plugin entry shape identical without requiring that missing package.
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

export default definePluginEntry({
  id: 'agenticdome-security',
  name: 'AgenticDome Shield',

  register(api) {
    const firewall = new OpenClawFirewall();

    // 1. Prompt ingress scan
    api.on('before_agent_run', async (event: any) => {
      try {
        await firewall.screenPrompt({
          text: event.prompt || '',
          agentId: String(event.ctx.agentId),
          sessionId: String(event.ctx.sessionId || ''),
        });

        return {};
      } catch (error: any) {
        return {
          block: true,
          blockReason:
            error?.message || 'Prompt blocked by AgenticDome policy',
        };
      }
    });

    // 2. Security execution gateway
    api.on('before_tool_call', async (event: any) => {
      const agentId = String(event.ctx.agentId);
      const sessionId = String(event.ctx.sessionId || '');
      const toolName = String(event.toolName || '').trim();

      const {
        params: workingParams,
        decisionToken,
        sourceAgentId,
      } = cleanInternalParams(event.params || {});

      const contextSourceAgentId = sourceAgentId || event.ctx.sourceAgentId;

      try {
        // Case A: Specialist delegated execution verification
        if (contextSourceAgentId || decisionToken) {
          await firewall.verifySpecialistExecution({
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

        // ──────────────────────────────────────────────────────────────
        // Case B: Manager handoff routing
        // ──────────────────────────────────────────────────────────────
        const handoffTools = [
          'route_to_agent',
          'delegate_task',
          'handoff_to_agent',
          'transfer_to_agent',
        ];

        if (handoffTools.includes(toolName)) {
          const targetId = workingParams.target_agent_id;
          const targetTool = workingParams.target_tool_name;

          // Clean clone the nested arguments to avoid mutating original input.
          const rawTargetArgs =
            workingParams.target_tool_args || workingParams.skill_args || {};
          const targetArgs = shallowCloneObject(rawTargetArgs);

          const authzEnvelope = await firewall.authorizeManagerHandoff({
            text: `Manager ${agentId} delegating to ${targetId}`,
            managerAgentId: agentId,
            specialistAgentId: String(targetId),
            skillName: String(targetTool),
            skillArgs: targetArgs,
            sessionId,
          });

          if (authzEnvelope.decision_token) {
            // 1. Inject into the immediate tracking framework.
            workingParams._decision_token = authzEnvelope.decision_token;
            workingParams._source_agent_id = agentId;

            // 2. Inject into nested parameters going downstream to specialist.
            targetArgs._decision_token = authzEnvelope.decision_token;
            targetArgs._source_agent_id = agentId;

            // 3. Bind protected parameters back to the execution schema.
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
        await firewall.authorizeDirectSkill({
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

    // 3. Egress output sanitization / DLP
    api.on('tool_result_persist', async (event: any) => {
      try {
        const sanitizedText = await firewall.sanitizeOutput({
          text: String(event.content ?? ''),
          agentId: String(event.ctx.agentId),
          sessionId: String(event.ctx.sessionId || ''),
        });

        return {
          content: sanitizedText,
        };
      } catch (error: any) {
        return {
          block: true,
          blockReason:
            error?.message || 'Output blocked by AgenticDome policy',
        };
      }
    });
  },
});

export { OpenClawFirewall };

export {
  OpenClawExecutionDenied,
  OpenClawFirewallError,
  safeResultToText,
} from './firewall';
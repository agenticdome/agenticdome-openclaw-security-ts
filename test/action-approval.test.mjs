import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawFirewall } from '../dist/firewall.mjs';

test('approval pauses survive fail-open configuration and are never retried', async (t) => {
  const firewall = new OpenClawFirewall({ apiBase: 'https://cert.invalid', apiKey: 'fixture', tenantId: 'fixture', failClosed: false, requireExplicitSessionId: false, retryMaxAttempts: 3 });
  const pending = new Error('Approval required'); pending.name = 'ApprovalRequired';
  t.after(() => firewall.close());
  let calls = 0;
  firewall.client.guardrailValidate = async () => { calls++; throw pending; };
  await assert.rejects(() => firewall.authorizeDirectSkill({ text: 'Prepare report', agentId: 'agent', skillName: 'chat', skillArgs: {}, sessionId: 'run' }), error => error === pending);
  assert.equal(calls, 1);
});

test('a direct pending verdict from an older SDK cannot execute through fail-open', async (t) => {
  const firewall = new OpenClawFirewall({ apiBase: 'https://cert.invalid', apiKey: 'fixture', tenantId: 'fixture', failClosed: false, requireExplicitSessionId: false });
  firewall.client.guardrailValidate = async () => ({ verdict: 'APPROVAL_REQUIRED' });
  firewall.client.request = async () => ({ durably_queued: true });
  t.after(async () => { await firewall.client.lifecycle.flush(); firewall.close(); });
  let executed = false;
  await assert.rejects(() => firewall.protectedExecute({ text: 'Prepare report', agentId: 'agent', skillName: 'chat', skillArgs: {}, sessionId: 'run', skillFunc: () => { executed = true; } }), error => error.name === 'ApprovalRequired');
  assert.equal(executed, false);
});

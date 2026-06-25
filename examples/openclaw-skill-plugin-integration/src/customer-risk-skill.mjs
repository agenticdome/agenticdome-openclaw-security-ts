import { OpenClawFirewall } from 'agenticdome-openclaw-security';

const firewall = new OpenClawFirewall();

async function lookupCustomerRisk(args) {
  return {
    customer_id: args.customer_id,
    risk: 'medium',
    analyst_note: 'Contact alice@example.test before approving payment changes.',
    internal_token: 'sk_example_openclaw_skill_secret',
  };
}

try {
  const result = await firewall.protectedExecute({
    agentId: 'openclaw-support-agent',
    sessionId: `example-${Date.now()}`,
    skillName: 'crm.customer_risk.lookup',
    skillArgs: {
      customer_id: 'cust_123',
      actor_role: 'support',
    },
    toolPlatform: 'crm',
    text: 'Support agent is looking up customer risk before taking account action.',
    policyContext: {
      environment: 'developer_example',
      request_purpose: 'customer_risk_lookup',
      actor_role: 'support',
    },
    skillFunc: lookupCustomerRisk,
  });

  console.log(result);
} finally {
  firewall.close();
}

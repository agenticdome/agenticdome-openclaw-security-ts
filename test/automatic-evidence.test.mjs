import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawFirewall } from '../dist/firewall.mjs';

function firewallWithEvidence() {
  const records = [];
  const firewall = new OpenClawFirewall({apiBase:'https://runtime.example',apiKey:'key',tenantId:'2',requireExplicitSessionId:false});
  firewall.client.request = async (_method, path, options) => {
    records.push({path,...options.jsonBody});
    return {durably_queued:true};
  };
  firewall.client.guardrailValidate = async () => ({verdict:'ALLOWED'});
  firewall.sanitizeOutput = async ({text}) => text;
  return {firewall, records};
}

test('protected execution reports ordered SDK evidence through runtime credentials', async () => {
  const {firewall,records} = firewallWithEvidence();
  const result = await firewall.protectedExecute({agentId:'agent',skillName:'lookup',skillFunc:async () => 'ok',skillArgs:{secret:'RAW_SECRET'},sessionId:'session',text:'lookup'});
  assert.equal(result,'ok');
  assert.equal(await firewall.client.lifecycle.flush(),true);
  assert.deepEqual(records.map(record => record.phase || record.outcome_class),['requested','authorised','admitted','attempted','succeeded']);
  assert.equal(new Set(records.map(record => record.chain_id)).size,1);
  assert.equal(records.at(-1).assurance_level,'sdk_reported');
  assert.equal(JSON.stringify(records).includes('RAW_SECRET'),false);
  firewall.close();
});

test('blocked protected execution never records an attempt or invokes the handler', async () => {
  const {firewall,records} = firewallWithEvidence();
  firewall.client.guardrailValidate = async () => ({verdict:'BLOCKED'});
  let attempted = false;
  await assert.rejects(() => firewall.protectedExecute({agentId:'agent',skillName:'lookup',skillFunc:async () => {attempted=true;},skillArgs:{},sessionId:'session',text:'lookup'}));
  assert.equal(await firewall.client.lifecycle.flush(),true);
  assert.equal(attempted,false);
  assert.deepEqual(records.map(record => record.phase || record.outcome_class),['requested','authorised','not_attempted']);
  assert.equal(records.at(-1).attempted_at,undefined);
  firewall.close();
});

test('handler failure produces a failed receipt', async () => {
  const {firewall,records} = firewallWithEvidence();
  await assert.rejects(() => firewall.protectedExecute({agentId:'agent',skillName:'lookup',skillFunc:async () => {throw Error('handler failure');},skillArgs:{},sessionId:'session',text:'lookup'}));
  assert.equal(await firewall.client.lifecycle.flush(),true);
  assert.equal(records.at(-1).outcome_class,'failed');
  firewall.close();
});

test('native hooks correlate concurrent tool IDs and report only completed executions', async () => {
  process.env.AGENTICDOME_API_BASE='https://runtime.example';
  process.env.AGENTICDOME_API_KEY='key';
  process.env.AGENTICDOME_TENANT_ID='2';
  process.env.AGENTICDOME_REQUIRE_SESSION_ID='false';
  const {default:plugin,OpenClawFirewall:PluginFirewall}=await import(`../dist/index.mjs?native=${Date.now()}`);
  const records=[];
  let firewall;
  const original = PluginFirewall.prototype.authorizeDirectSkill;
  PluginFirewall.prototype.authorizeDirectSkill = async function(args) {
    firewall=this;
    this.client.request=async (_method,_path,options) => {records.push(options.jsonBody);return {durably_queued:true};};
    if(args.skillName==='deny')throw Error('blocked');
    return {verdict:'ALLOWED'};
  };
  try {
    const hooks = new Map();plugin.register({on:(name,handler) => hooks.set(name,handler)});
    const ctx={agentId:'agent',sessionKey:'session',runId:'run'};
    const first = await hooks.get('before_tool_call')({toolName:'lookup',params:{secret:'RAW_INPUT'},toolCallId:'first'},ctx);
    assert.equal(first.block,undefined,first.blockReason);
    await hooks.get('before_tool_call')({toolName:'lookup',params:{secret:'RAW_INPUT'},toolCallId:'second'},ctx);
    assert.equal(await firewall.client.lifecycle.flush(),true);
    assert.equal(records.some(record => record.phase==='attempted' || record.outcome_class),false);
    const firstChain=records[0].chain_id,secondChain=records[3].chain_id;
    hooks.get('after_tool_call')({toolName:'lookup',params:{secret:'RAW_INPUT'},toolCallId:'second',error:'handler failure'},ctx);
    hooks.get('after_tool_call')({toolName:'lookup',params:{secret:'RAW_INPUT'},toolCallId:'first',result:{ok:true}},ctx);
    hooks.get('after_tool_call')({toolName:'lookup',params:{secret:'RAW_INPUT'},toolCallId:'first',result:{ok:true}},ctx);
    await firewall.client.lifecycle.flush();
    const outcomes=records.filter(record => record.outcome_class);
    assert.deepEqual(outcomes.map(record => [record.chain_id,record.outcome_class]),[[secondChain,'failed'],[firstChain,'succeeded']]);
    const blocked=await hooks.get('before_tool_call')({toolName:'deny',params:{},toolCallId:'blocked'},ctx);
    assert.equal(blocked.block,true);await firewall.client.lifecycle.flush();
    assert.equal(records.at(-1).outcome_class,'not_attempted');
    assert.equal(JSON.stringify(records).includes('RAW_INPUT'),false);
  } finally {
    PluginFirewall.prototype.authorizeDirectSkill=original;
    firewall?.close();
    for(const key of ['AGENTICDOME_API_BASE','AGENTICDOME_API_KEY','AGENTICDOME_TENANT_ID','AGENTICDOME_REQUIRE_SESSION_ID'])delete process.env[key];
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.env.OPENCLAW_REPO_PATH || '/tmp/openclaw-real';
const requiredFiles = [
  'src/plugins/hook-types.ts',
  'src/plugins/hooks.ts',
  'src/plugin-sdk/plugin-entry.ts',
  'packages/plugin-sdk/package.json',
];

function readReal(relativePath) {
  const full = path.join(repo, relativePath);
  if (!fs.existsSync(full)) {
    return null;
  }
  return fs.readFileSync(full, 'utf8');
}

test('real OpenClaw repository is available for compatibility checks', { skip: !fs.existsSync(repo) }, () => {
  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(path.join(repo, file)), `${file} exists in real OpenClaw checkout`);
  }
});

test('plugin entry matches real OpenClaw plugin-entry metadata contract', { skip: !fs.existsSync(repo) }, async () => {
  const entrySource = readReal('src/plugin-sdk/plugin-entry.ts');
  assert.match(entrySource, /description:\s*string/);
  assert.match(entrySource, /configSchema\?/);
  assert.match(entrySource, /definePluginEntry/);

  const { default: plugin } = await import(`../dist/index.mjs?realEntry=${Date.now()}`);
  assert.equal(plugin.id, 'agenticdome-security');
  assert.equal(plugin.name, 'AgenticDome OpenClaw Action Firewall');
  assert.equal(typeof plugin.description, 'string');
  assert.ok(plugin.description.length > 30);
  assert.equal(plugin.configSchema.type, 'object');
  assert.equal(plugin.configSchema.additionalProperties, false);
});

test('registered hooks are real OpenClaw hooks and sync-only persist hook stays synchronous', { skip: !fs.existsSync(repo) }, async () => {
  const hookTypes = readReal('src/plugins/hook-types.ts');
  const hooksRuntime = readReal('src/plugins/hooks.ts');

  for (const hookName of ['before_agent_run', 'before_tool_call', 'tool_result_persist']) {
    assert.match(hookTypes, new RegExp(`\\"${hookName}\\"|${hookName}`), `${hookName} is declared by real OpenClaw`);
  }
  assert.match(hooksRuntime, /tool_result_persist handler from .* returned a Promise/);
  assert.match(hooksRuntime, /this hook is synchronous and the result was ignored/);

  process.env.AGENTICDOME_API_BASE = 'https://api.example.test';
  process.env.AGENTICDOME_API_KEY = 'test-key';
  process.env.AGENTICDOME_TENANT_ID = 'tenant-1';
  process.env.AGENTICDOME_REQUIRE_SESSION_ID = 'false';

  const { default: plugin } = await import(`../dist/index.mjs?realHooks=${Date.now()}`);
  const handlers = new Map();
  plugin.register({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });

  assert.deepEqual([...handlers.keys()].sort(), ['before_agent_run', 'before_tool_call', 'tool_result_persist']);

  const persistHandler = handlers.get('tool_result_persist');
  assert.notEqual(persistHandler.constructor.name, 'AsyncFunction');
  const out = persistHandler({
    toolName: 'lookup',
    toolCallId: 'call-1',
    message: {
      role: 'toolResult',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'person@example.test token=abc1234567890' }],
      details: { stdout: 'Authorization: Bearer abc1234567890abcdef' },
    },
  }, { agentId: 'agent-1', sessionKey: 'sess-1' });

  assert.ok(out && typeof out === 'object');
  assert.ok(!out.then, 'tool_result_persist did not return a Promise');
  assert.equal(out.message.role, 'toolResult');
  assert.equal(out.message.toolCallId, 'call-1');
  assert.match(out.message.content[0].text, /\[EMAIL_REDACTED\]/);
  assert.match(out.message.details.stdout, /Bearer \[SECRET_REDACTED\]/);
});

test('published manifest matches plugin export and real extension convention', { skip: !fs.existsSync(repo) }, async () => {
  const bonjourManifest = readReal('extensions/bonjour/openclaw.plugin.json');
  const bonjourPackage = readReal('extensions/bonjour/package.json');
  assert.match(bonjourManifest, /"activation"/);
  assert.match(bonjourPackage, /"openclaw"/);
  assert.match(bonjourPackage, /"extensions"/);

  const manifest = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { default: plugin } = await import(`../dist/index.mjs?realManifest=${Date.now()}`);

  assert.equal(manifest.id, plugin.id);
  assert.equal(manifest.name, plugin.name);
  assert.equal(manifest.description, plugin.description);
  assert.deepEqual(manifest.configSchema, plugin.configSchema);
  assert.deepEqual(packageJson.openclaw.extensions, ['./dist/index.mjs']);
});

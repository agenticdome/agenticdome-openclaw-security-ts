import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticdome-openclaw-cli-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 180_000,
  });
}

function parseLastJson(text) {
  const start = text.lastIndexOf('\n{');
  const raw = start >= 0 ? text.slice(start + 1) : text.slice(text.indexOf('{'));
  return JSON.parse(raw);
}

function resolveOpenClawRuntime() {
  const metadata = JSON.parse(
    run('npm', ['view', 'openclaw@latest', 'version', 'engines', '--json', '--silent'])
  );
  const version = String(metadata?.version || '').trim();
  const nodeEngine = String(metadata?.engines?.node || '').trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'npm returned an immutable OpenClaw version');
  assert.ok(nodeEngine, 'OpenClaw declares engines.node');

  const majors = [...nodeEngine.matchAll(/(?:^|\|\|)\s*>=?\s*(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((major) => Number.isInteger(major) && major > 0);
  assert.ok(majors.length > 0, `Unable to derive a Node major from OpenClaw engines.node: ${nodeEngine}`);

  return { version, nodeEngine, nodeMajor: majors[0] };
}

try {
  run('npm', ['pack', '--pack-destination', tmp]);
  const tarballs = fs.readdirSync(tmp).filter((name) => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'npm pack produced one tarball');

  const home = path.join(tmp, 'home');
  const openclawEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
  const runtime = resolveOpenClawRuntime();
  const cli = ['-y', '-p', `node@${runtime.nodeMajor}`, '-p', `openclaw@${runtime.version}`, 'openclaw'];
  const spec = `npm-pack:${path.join(tmp, tarballs[0])}`;

  run('npx', [...cli, 'plugins', 'install', spec, '--force'], { env: openclawEnv, timeout: 240_000 });
  run(
    'npx',
    [...cli, 'config', 'set', 'plugins.entries.agenticdome-security.hooks.allowConversationAccess', 'true'],
    { env: openclawEnv, timeout: 180_000 }
  );
  const inspectText = run(
    'npx',
    [...cli, 'plugins', 'inspect', 'agenticdome-security', '--runtime', '--json'],
    { env: openclawEnv, timeout: 240_000 }
  );
  const inspect = parseLastJson(inspectText);
  const hooks = (inspect.typedHooks || []).map((item) => item.name).sort();

  assert.equal(inspect.plugin?.status, 'loaded');
  assert.equal(inspect.plugin?.hookCount, 3);
  assert.deepEqual(hooks, ['before_agent_run', 'before_tool_call', 'tool_result_persist']);
  assert.equal(inspect.policy?.allowConversationAccess, true);

  console.log(JSON.stringify({
    status: 'passed',
    openclaw_plugin_status: inspect.plugin.status,
    openclaw_version: runtime.version,
    openclaw_node_engine: runtime.nodeEngine,
    selected_node_major: runtime.nodeMajor,
    hook_count: inspect.plugin.hookCount,
    hooks,
  }, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

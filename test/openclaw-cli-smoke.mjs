import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticdome-openclaw-cli-'));
const npmCache = path.join(tmp, 'npm-cache');
const isolatedEnv = {
  ...process.env,
  npm_config_cache: npmCache,
};

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

function resolveOpenClawRuntime(env) {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const certifiedTarget = String(packageManifest?.openclaw?.build?.openclawVersion || '').trim();
  assert.match(certifiedTarget, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package metadata declares a certified OpenClaw build target');
  const metadata = JSON.parse(
    run('npm', ['view', `openclaw@${certifiedTarget}`, 'version', 'engines', '--json', '--silent'], { env })
  );
  const version = String(metadata?.version || '').trim();
  const nodeEngine = String(metadata?.engines?.node || '').trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'npm returned an immutable OpenClaw version');
  assert.equal(version, certifiedTarget, 'npm resolved the certified OpenClaw build target');
  assert.ok(nodeEngine, 'OpenClaw declares engines.node');

  const majors = [...nodeEngine.matchAll(/(?:^|\|\|)\s*>=?\s*(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((major) => Number.isInteger(major) && major > 0);
  assert.ok(majors.length > 0, `Unable to derive a Node major from OpenClaw engines.node: ${nodeEngine}`);

  return { version, nodeEngine, nodeMajor: majors[0] };
}

function resolveNodeRuntime(runtime, env) {
  const output = run(
    'npx',
    ['-y', '-p', `node@${runtime.nodeMajor}`, 'node', '-p', 'process.execPath'],
    { env, timeout: 240_000 }
  );
  const binary = output.trim().split(/\r?\n/).at(-1) || '';
  assert.ok(path.isAbsolute(binary) && fs.existsSync(binary), 'npx resolved an executable Node runtime path');
  const version = run(binary, ['--version'], { env }).trim().replace(/^v/, '');
  assert.equal(Number(version.split('.')[0]), runtime.nodeMajor, 'the resolved Node runtime has the required major');
  return { binary, version };
}

function installOpenClawCli(runtime, node, env) {
  const cliRoot = path.join(tmp, 'openclaw-cli');
  const nodeEnv = {
    ...env,
    PATH: `${path.dirname(node.binary)}${path.delimiter}${env.PATH || ''}`,
  };
  run(
    'npm',
    ['install', '--prefix', cliRoot, '--no-save', '--no-audit', '--no-fund', `openclaw@${runtime.version}`],
    { env: nodeEnv, timeout: 600_000 }
  );
  const entry = path.join(cliRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  assert.ok(fs.existsSync(entry), 'the exact OpenClaw CLI entry point was installed');
  return { nodeEnv, entry };
}

function runOpenClaw(node, cli, args, timeout = 240_000) {
  return run(node.binary, [cli.entry, ...args], { env: cli.nodeEnv, timeout });
}

try {
  const home = path.join(tmp, 'home');
  const openclawEnv = {
    ...isolatedEnv,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
  const runtime = resolveOpenClawRuntime(openclawEnv);
  const node = resolveNodeRuntime(runtime, openclawEnv);
  const cli = installOpenClawCli(runtime, node, openclawEnv);

  const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const pluginPack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tmp], { env: cli.nodeEnv }))[0];
  assert.equal(pluginPack.name, pluginManifest.name);
  assert.equal(pluginPack.version, pluginManifest.version);
  let spec = `npm-pack:${path.join(tmp, pluginPack.filename)}`;
  let linkedCandidate = false;
  const coreSource = process.env.AGENTICDOME_CORE_SDK_SOURCE || path.resolve(root, '../../../js/agentguard_sdk/src');
  if (fs.existsSync(path.join(coreSource, 'package.json'))) {
    const coreManifest = JSON.parse(fs.readFileSync(path.join(coreSource, 'package.json'), 'utf8'));
    assert.equal(coreManifest.name, 'agenticdome-sdk');
    const corePack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: coreSource, env: cli.nodeEnv }))[0];
    assert.equal(corePack.version, coreManifest.version);
    const installRoot = path.join(tmp, 'candidate-install');
    fs.mkdirSync(installRoot);
    fs.writeFileSync(path.join(installRoot, 'package.json'), JSON.stringify({private: true, type: 'module'}));
    run('npm', ['install', path.join(tmp, corePack.filename), path.join(tmp, pluginPack.filename), '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: installRoot, env: cli.nodeEnv});
    const installedCore = JSON.parse(fs.readFileSync(path.join(installRoot, 'node_modules/agenticdome-sdk/package.json'), 'utf8'));
    assert.equal(installedCore.version, coreManifest.version);
    spec = path.join(installRoot, 'node_modules/agenticdome-openclaw-security');
    linkedCandidate = true;
  }

  const installHelp = runOpenClaw(node, cli, ['plugins', 'install', '--help']);
  const installArgs = ['plugins', 'install', spec];
  if (linkedCandidate) {
    assert.ok(installHelp.includes('--link'), 'OpenClaw supports loading clean-installed local candidates');
    installArgs.push('--link');
    if (/--force\s+Confirm non-ClawHub sources/i.test(installHelp)) {
      // New CLIs require source consent; older CLIs reject --force with --link.
      installArgs.push('--force');
    }
  } else {
    installArgs.push('--force');
  }
  if (installHelp.includes('--accept-capabilities')) {
    // This exact local tarball is the release candidate under test. New OpenClaw
    // versions require explicit consent; older certified versions reject the flag.
    installArgs.push('--accept-capabilities');
  }
  runOpenClaw(node, cli, installArgs);
  runOpenClaw(
    node,
    cli,
    ['config', 'set', 'plugins.entries.agenticdome-security.hooks.allowConversationAccess', 'true'],
    180_000
  );
  const inspectText = runOpenClaw(node, cli, ['plugins', 'inspect', 'agenticdome-security', '--runtime', '--json']);
  const inspect = parseLastJson(inspectText);
  const hooks = (inspect.typedHooks || []).map((item) => item.name).sort();

  assert.equal(inspect.plugin?.status, 'loaded');
  assert.equal(inspect.plugin?.hookCount, 4);
  assert.deepEqual(hooks, ['after_tool_call', 'before_agent_run', 'before_tool_call', 'tool_result_persist']);
  assert.equal(inspect.policy?.allowConversationAccess, true);

  console.log(JSON.stringify({
    status: 'passed',
    openclaw_plugin_status: inspect.plugin.status,
    openclaw_version: runtime.version,
    openclaw_node_engine: runtime.nodeEngine,
    selected_node_major: runtime.nodeMajor,
    selected_node_version: node.version,
    hook_count: inspect.plugin.hookCount,
    hooks,
    install_mode: linkedCandidate ? 'clean_local_tarballs_linked' : 'registry_dependencies',
  }, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

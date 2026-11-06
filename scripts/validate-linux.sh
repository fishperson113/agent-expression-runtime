#!/bin/sh
set -eu
mkdir -p /work
if [ -d /source ]; then
  tar -C /source --exclude=./node_modules --exclude=./.git --exclude=./src-tauri/target \
    --exclude=./.runtime --exclude=./dist --exclude='./.env*' --exclude=./.codex \
    --exclude=./.agents --exclude=./.npm-cache -cf - . | tar -C /work -xf -
fi
cd /work
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
uname -a
node --version
cargo --version
npm ci
npm link
fisch --help
fisch --version
fisch build
fisch test
export AER_GATEWAY_EXE=/work/src-tauri/target/debug/agent-expression-runtime
node scripts/browser-bridge-smoke.mjs
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
writeFileSync('docs/evidence/linux-validation.json', JSON.stringify({
  platform: process.platform, arch: process.arch, node: process.version,
  kernel: execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(),
  cargo: execFileSync('cargo', ['--version'], { encoding: 'utf8' }).trim(),
  fisch: execFileSync('fisch', ['--version'], { encoding: 'utf8' }).trim(),
  cliBuild: 'passed', cliTest: 'passed',
  frontendBuild: 'passed', architecture: 'passed', nativeBuild: 'passed',
  rustTests: 'passed', javascriptTests: 'passed', browserBridge: 'passed',
  timestamp: new Date().toISOString(),
}, null, 2) + '\n');
JS

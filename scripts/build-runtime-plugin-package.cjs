#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { PLUGIN_CONTRACT_VERSION } = require(path.join(__dirname, '..', 'src', 'runtime', 'apiwrappers', 'plugindtocontract.cjs'));

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

/** @type {Array<{ src: string, dest: string }>} */
const FILE_MAPPINGS = [
  { src: path.join('src', 'runtime', 'apiwrappers', 'plugindtocontract.cjs'), dest: 'apiwrappers/plugindtocontract.cjs' },
  { src: path.join('src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-plugin-module.cjs'), dest: 'apiwrappers/reg-hakuneko/hakuneko-plugin-module.cjs' },
  { src: path.join('src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-adapter.cjs'), dest: 'apiwrappers/reg-hakuneko/hakuneko-adapter.cjs' },
  { src: path.join('src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-settings.cjs'), dest: 'apiwrappers/reg-hakuneko/hakuneko-settings.cjs' },
  { src: path.join('src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-plugin-settings.json'), dest: 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json' },
  { src: path.join('src', 'runtime', 'images', 'hakuneko-icon.svg'), dest: 'images/hakuneko-icon.svg' },
];

function parseCliArgs(argv) {
  let outputPath = null;
  let hostApiVersion = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--output') { outputPath = argv[i + 1] || null; i++; continue; }
    if (token === '--host-api-version') { hostApiVersion = argv[i + 1] || null; i++; continue; }
    positional.push(token);
  }
  if (!outputPath && positional.length > 0) outputPath = positional[0];
  if (!hostApiVersion && positional.length > 1) hostApiVersion = positional[1];
  return { outputPath, hostApiVersion };
}

function resolveHostApiVersion(explicitVersion) {
  return String(explicitVersion || process.env.MANGALIST_HOST_API_VERSION || '1.0.0').trim() || '1.0.0';
}

function resolveOutputPath(explicitPath) {
  if (explicitPath && explicitPath.trim()) return path.resolve(explicitPath.trim());
  return path.join(DIST_DIR, 'hakuneko-adapter-1.0.0.zip');
}

function ensureDistDir() {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
}

function readJsonObjectFile(fullPath, label) {
  if (!fs.existsSync(fullPath)) throw new Error(`Missing ${label} file: ${fullPath}`);
  const raw = fs.readFileSync(fullPath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`Invalid JSON in ${label}: ${e.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Expected object in ${label}`);
  return parsed;
}

function buildManifest(hostApiVersion) {
  const pluginPackagePath = path.join(ROOT_DIR, 'plugin-package.json');
  const pluginPackage = readJsonObjectFile(pluginPackagePath, 'plugin-package.json');
  const contractVersion = typeof pluginPackage.pluginContractVersion === 'string' ? pluginPackage.pluginContractVersion : '1.0.0';
  const contractMajor = contractVersion.split('.')[0];
  const pluginContractMajor = PLUGIN_CONTRACT_VERSION.split('.')[0];
  if (contractMajor !== pluginContractMajor) {
    throw new Error(`pluginContractVersion major mismatch: plugin-package.json says ${contractVersion}, PLUGIN_CONTRACT_VERSION is ${PLUGIN_CONTRACT_VERSION}`);
  }
  return {
    ...pluginPackage,
    hostApiVersion,
  };
}

function buildHakunekoPackage(options = {}) {
  ensureDistDir();
  const outputPath = resolveOutputPath(options.outputPath || null);
  const hostApiVersion = resolveHostApiVersion(options.hostApiVersion || null);
  const manifest = buildManifest(hostApiVersion);

  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve({ outputPath, manifest, fileCount: FILE_MAPPINGS.length + 1 }));
    archive.on('warning', (e) => { if (e.code === 'ENOENT') { console.warn('Warning:', e.message); return; } reject(e); });
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'plugin-package.json' });

    for (const file of FILE_MAPPINGS) {
      const fullSource = path.join(ROOT_DIR, file.src);
      if (!fs.existsSync(fullSource)) { reject(new Error(`Missing source file: ${file.src}`)); return; }
      archive.file(fullSource, { name: file.dest });
    }

    archive.finalize().catch(reject);
  });
}

async function runFromCli() {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await buildHakunekoPackage(args);
  console.log(`Plugin package built: ${result.outputPath}`);
  console.log(`pluginName=${result.manifest.pluginName} hostApiVersion=${result.manifest.hostApiVersion}`);
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { buildManifest, buildHakunekoPackage };

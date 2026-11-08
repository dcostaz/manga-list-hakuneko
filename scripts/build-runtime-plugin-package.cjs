#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { PLUGIN_CONTRACT_VERSION } = require('@manga-list/plugin-sdk');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const REG_DIR = path.join('src', 'runtime', 'apiwrappers', 'reg-hakuneko');
const MANIFEST_PATH = path.join(ROOT_DIR, REG_DIR, 'plugin-package.json');

/**
 * The plugin's files: every module and the settings document beside the definition, and the icon. The manifest is
 * written separately, at the root the loader reads and beside the definition, which requires it. The SDK is never
 * bundled: the host stages its own copy beside the plugin runtime root.
 * @type {Array<{ src: string, dest: string }>}
 */
const FILE_MAPPINGS = [
  ...fs.readdirSync(path.join(ROOT_DIR, REG_DIR))
    .filter((name) => /\.(cjs|json)$/.test(name) && name !== 'plugin-package.json')
    .map((name) => ({ src: path.join(REG_DIR, name), dest: `apiwrappers/reg-hakuneko/${name}` })),
  { src: path.join('src', 'runtime', 'images', 'hakuneko-icon.svg'), dest: 'images/hakuneko-icon.svg' },
];

// host-capability-contract.md §4.2: the whole web/ tree (the workspace.entry surface) is copied
// recursively — a plugin author can add a script/stylesheet under web/ without touching this file.
const WEB_SOURCE_DIR = path.join('src', 'runtime', 'web');
const WEB_DEST_PREFIX = 'web';

/**
 * Recursively list every file under `dirAbs` as `{ src, dest }` rows with POSIX zip-relative
 * `dest` paths under `destPrefix`. Returns [] when the directory is absent.
 * @param {string} dirAbs
 * @param {string} destPrefix
 * @returns {Array<{ src: string, dest: string }>}
 */
function collectTree(dirAbs, destPrefix) {
  if (!fs.existsSync(dirAbs)) return [];
  /** @type {Array<{ src: string, dest: string }>} */
  const out = [];
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const childAbs = path.join(dirAbs, entry.name);
    const childDest = `${destPrefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectTree(childAbs, childDest));
    else if (entry.isFile()) out.push({ src: childAbs, dest: childDest });
  }
  return out;
}

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
  return path.join(DIST_DIR, `hakuneko-adapter-${readJsonObjectFile(MANIFEST_PATH, 'plugin-package.json').pluginContractVersion}-${commitStamp()}.zip`);
}

/** The short commit the zip is built from, so a rebuilt zip is told from the old one; `nogit` outside a checkout. */
function commitStamp() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'nogit';
  } catch {
    return 'nogit';
  }
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
  const pluginPackage = readJsonObjectFile(MANIFEST_PATH, 'plugin-package.json');
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

  const webFiles = collectTree(path.join(ROOT_DIR, WEB_SOURCE_DIR), WEB_DEST_PREFIX);

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve({
      outputPath,
      manifest,
      fileCount: FILE_MAPPINGS.length + webFiles.length + 2,
      webFiles: webFiles.map((f) => f.dest)
    }));
    archive.on('warning', (e) => { if (e.code === 'ENOENT') { console.warn('Warning:', e.message); return; } reject(e); });
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'plugin-package.json' });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'apiwrappers/reg-hakuneko/plugin-package.json' });

    for (const file of FILE_MAPPINGS) {
      const fullSource = path.join(ROOT_DIR, file.src);
      if (!fs.existsSync(fullSource)) { reject(new Error(`Missing source file: ${file.src}`)); return; }
      archive.file(fullSource, { name: file.dest });
    }

    for (const file of webFiles) archive.file(file.src, { name: file.dest });

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

module.exports = { buildManifest, buildHakunekoPackage, collectTree };

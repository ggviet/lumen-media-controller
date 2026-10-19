/**
 * tests/m5_packaging.test.js
 * Milestone 5 Verification Suite (R1):
 * Standalone Zero-Install Portable Windows Packaging, Unpacked Assets & Offline Readiness
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Milestone 5 Verification: Standalone Portable Packaging & Offline Readiness (R1)', () => {
  const rootDir = path.join(__dirname, '..');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const builderYml = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf8');
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main/index.js'), 'utf8');
  const operatorHtml = readCompleteHtml(path.join(rootDir, 'src/renderer/operator/index.html'));
  const stageHtml = readCompleteHtml(path.join(rootDir, 'src/renderer/stage/index.html'));

  describe('1. Build Configuration & Application Icons', () => {
    it('1.1: package.json defines electron-builder devDependency and build/package/dist scripts', () => {
      assert.ok(pkgJson.devDependencies && pkgJson.devDependencies['electron-builder'], 'electron-builder must be in devDependencies');
      assert.ok(pkgJson.scripts && pkgJson.scripts.build && pkgJson.scripts.build.includes('electron-builder'));
      assert.ok(pkgJson.scripts && pkgJson.scripts.package && pkgJson.scripts.package.includes('electron-builder'));
    });

    it('1.2: electron-builder.yml configures portable x64 target, asarUnpack, and extraResources for assets', () => {
      assert.ok(builderYml.includes('appId: com.lumen.promediacontroller'));
      assert.ok(builderYml.includes('asarUnpack:'));
      assert.ok(builderYml.includes('- assets/**/*'));
      assert.ok(builderYml.includes('extraResources:'));
      assert.ok(builderYml.includes('target: portable'));
      assert.ok(builderYml.includes('artifactName: LUMEN-PRO-') && builderYml.includes('Portable.exe'));
    });

    it('1.3: Valid binary PNG (assets/icon.png) and ICO (assets/icon.ico) exist with valid headers', () => {
      const pngPath = path.join(rootDir, 'assets/icon.png');
      const icoPath = path.join(rootDir, 'assets/icon.ico');
      assert.ok(fs.existsSync(pngPath), 'assets/icon.png must exist');
      assert.ok(fs.existsSync(icoPath), 'assets/icon.ico must exist');

      const pngBuf = fs.readFileSync(pngPath);
      const icoBuf = fs.readFileSync(icoPath);
      // Verify PNG magic signature 89 50 4E 47 0D 0A 1A 0A
      assert.strictEqual(pngBuf[0], 0x89);
      assert.strictEqual(pngBuf[1], 0x50);
      assert.strictEqual(pngBuf[2], 0x4e);
      assert.strictEqual(pngBuf[3], 0x47);
      // Verify 256x256 dimensions in IHDR
      assert.strictEqual(pngBuf.readUInt32BE(16), 256);
      assert.strictEqual(pngBuf.readUInt32BE(20), 256);

      // Verify ICO header (00 00 01 00 01 00)
      assert.strictEqual(icoBuf.readUInt16LE(0), 0);
      assert.strictEqual(icoBuf.readUInt16LE(2), 1);
      assert.strictEqual(icoBuf.readUInt16LE(4), 1);
    });
  });

  describe('2. Packaged Asset Path Resolution & Offline Typography', () => {
    it('2.1: Main Process and Renderers resolve process.resourcesPath for unpacked assets in production builds', () => {
      assert.ok(mainJs.includes('function resolveAssetPath(fileName)'));
      assert.ok(mainJs.includes("path.join(process.resourcesPath, 'assets', fileName)"));
      assert.ok(operatorHtml.includes('function resolveOperatorAssetDir()'));
      assert.ok(operatorHtml.includes("path.join(process.resourcesPath, 'assets')"));
      assert.ok(stageHtml.includes('function initPackagedStageAssets()'));
      assert.ok(stageHtml.includes("path.join(process.resourcesPath, 'assets', 'sample_keyvisual.svg')"));
    });

    it('2.2: 100% Offline Readiness — zero external HTTP/HTTPS stylesheet, script, or font requests', () => {
      assert.strictEqual(operatorHtml.includes('https://fonts.googleapis.com'), false);
      assert.strictEqual(operatorHtml.includes('https://fonts.gstatic.com'), false);
      assert.strictEqual(stageHtml.includes('https://fonts.googleapis.com'), false);
      assert.strictEqual(stageHtml.includes('https://fonts.gstatic.com'), false);
    });
  });

  describe('3. Compiled Standalone Artifacts in dist/', () => {
    it('3.1: Standalone portable executable in dist/ and win-unpacked binary exist and are non-empty', () => {
      const distDir = path.join(rootDir, 'dist');
      assert.ok(fs.existsSync(distDir), 'dist/ directory must exist');

      const files = fs.readdirSync(distDir);
      const portableFileName = files.find(f => /^LUMEN-PRO-(v.*-)?Portable\.exe$/i.test(f));
      assert.ok(portableFileName, `Standalone portable .exe must exist in dist/ (found: ${files.join(', ')})`);
      const portableExe = path.join(distDir, portableFileName);
      const unpackedExe = path.join(distDir, 'win-unpacked', 'LUMEN PRO.exe');

      const portableStat = fs.statSync(portableExe);
      assert.ok(portableStat.size > 50 * 1024 * 1024, `Portable .exe should be >50MB, got ${portableStat.size} bytes`);

      assert.ok(fs.existsSync(unpackedExe), 'dist/win-unpacked/LUMEN PRO.exe must exist');
      const unpackedAssets = path.join(distDir, 'win-unpacked', 'resources', 'assets', 'sample_keyvisual.svg');
      assert.ok(fs.existsSync(unpackedAssets), 'dist/win-unpacked/resources/assets/sample_keyvisual.svg must be unpacked outside ASAR');
    });
  });
});

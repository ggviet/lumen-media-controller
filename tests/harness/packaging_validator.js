/**
 * tests/harness/packaging_validator.js
 * Packaging, Portability & Offline Compliance Validator for testing R1 requirements.
 */
const path = require('path');
const fs = require('fs');

class PackagingValidator {
  constructor(projectRoot = path.resolve(__dirname, '../..')) {
    this.projectRoot = projectRoot;
  }

  // Inspect package.json configuration
  getPackageJson() {
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`package.json not found at ${pkgPath}`);
    }
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  }

  // Validate electron-builder configuration specification
  validateBuilderConfig(config) {
    const errors = [];
    if (!config) {
      return { valid: false, errors: ['Configuration object is null or undefined'] };
    }

    // Windows target checks
    if (!config.win) {
      errors.push('Missing win configuration block');
    } else {
      const targets = Array.isArray(config.win.target) ? config.win.target : [config.win.target];
      const hasPortable = targets.some(t => (typeof t === 'string' ? t === 'portable' : t.target === 'portable'));
      if (!hasPortable) {
        errors.push('Missing portable target in win.target');
      }
    }

    // asarUnpack checks
    if (!config.asarUnpack) {
      errors.push('Missing asarUnpack configuration for HTML5 media streaming');
    }

    // extraResources checks
    if (!config.extraResources) {
      errors.push('Missing extraResources configuration for assets');
    }

    // Portable config block
    if (config.portable) {
      if (!config.portable.artifactName) {
        errors.push('Missing portable.artifactName');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Check offline font stack in HTML files
  checkOfflineFontStack(htmlContent) {
    const violations = [];
    // Detect Google Fonts CDN links
    if (htmlContent.includes('fonts.googleapis.com') || htmlContent.includes('fonts.gstatic.com')) {
      violations.push('Found remote Google Fonts CDN reference');
    }
    // Check if offline fallback font family exists
    const hasOfflineFallback = /font-family:[^;]*(Segoe UI|system-ui|sans-serif|Consolas)/i.test(htmlContent);
    return {
      compliant: violations.length === 0,
      violations,
      hasOfflineFallback
    };
  }

  // Resolve asset paths in packaged vs development runtime
  resolveAssetPath(assetRelativePath, isPackaged = false, resourcesPath = null) {
    if (isPackaged) {
      const base = resourcesPath || path.join(this.projectRoot, 'resources');
      return path.join(base, 'assets', assetRelativePath);
    }
    return path.join(this.projectRoot, 'assets', assetRelativePath);
  }

  // Check asset directory presence
  checkAssets() {
    const assetsDir = path.join(this.projectRoot, 'assets');
    const exists = fs.existsSync(assetsDir);
    const files = exists ? fs.readdirSync(assetsDir) : [];
    return {
      exists,
      files,
      hasLogoSvg: files.includes('logo.svg'),
      hasKeyvisualSvg: files.includes('sample_keyvisual.svg'),
      hasCountdownSvg: files.includes('sample_countdown.svg'),
      hasIconPng: files.includes('icon.png'),
      hasIconIco: files.includes('icon.ico')
    };
  }
}

module.exports = { PackagingValidator };

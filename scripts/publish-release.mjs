#!/usr/bin/env node

/**
 * Universal Release Coordinator for Furina (Mobile & Desktop)
 * Handles:
 * - Version change detection
 * - Offline artifact verification
 * - Manifest generation (YAML)
 * - Git commit, tag, and push
 * - GitHub Release creation & binary asset upload via GitHub REST API
 * - Edge CDN cache invalidation
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { purgeCdnFiles } from './purge-cdn.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const releasesDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(releasesDir, '..');

// Load environment variables (.env in releases or root)
dotenv.config({ path: path.join(releasesDir, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'SubhamCrid';
const GITHUB_REPO = 'furina-releases';

const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1] || 'all';
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

console.log('====================================================');
console.log('🚀 Furina Universal Release Coordinator');
console.log(`   Target:       ${targetArg.toUpperCase()}`);
console.log(`   Mode:         ${dryRun ? 'DRY-RUN (Simulated)' : 'PRODUCTION'}`);
console.log(`   Time:         ${new Date().toISOString()}`);
console.log('====================================================\n');

function runGit(cmd, cwd = releasesDir) {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return null;
  }
}

function calculateSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calculateSha512Base64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

async function githubApiRequest(endpoint, method = 'GET', body = null) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set. Please add it to releases/.env or your environment.');
  }

  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Furina-Release-Manager',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`GitHub API ${method} ${url} failed [${res.status}]: ${errorText}`);
  }
  return res.json().catch(() => ({}));
}

async function uploadReleaseAsset(uploadUrlTemplate, filePath, fileName) {
  const fileBuffer = fs.readFileSync(filePath);
  const cleanUploadUrl = uploadUrlTemplate.split('{')[0] + `?name=${encodeURIComponent(fileName)}`;

  console.log(`  ⬆️ Uploading asset: ${fileName} (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`);

  const res = await fetch(cleanUploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuffer.length.toString(),
      'User-Agent': 'Furina-Release-Manager',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to upload ${fileName} [${res.status}]: ${errText}`);
  }

  console.log(`  ✅ Asset uploaded successfully: ${fileName}`);
}

/**
 * ============================================================================
 * MOBILE RELEASE HANDLER
 * ============================================================================
 */
async function processMobileRelease() {
  console.log('\n--- [1/2] Evaluating Mobile Target (Furina Android) ---');

  const mobileDir = path.join(repoRoot, 'mobile');
  const mobilePackageJsonPath = path.join(mobileDir, 'package.json');
  const mobileAppJsonPath = path.join(mobileDir, 'app.json');

  if (!fs.existsSync(mobilePackageJsonPath)) {
    console.log('⚠️ Mobile directory not found. Skipping.');
    return { target: 'mobile', status: 'skipped', reason: 'Directory not found' };
  }

  const mobilePackage = JSON.parse(fs.readFileSync(mobilePackageJsonPath, 'utf-8'));
  const mobileAppJson = JSON.parse(fs.readFileSync(mobileAppJsonPath, 'utf-8'));
  const currentVersion = mobilePackage.version || '1.0.0';
  const currentVersionCode = mobileAppJson.expo?.android?.versionCode || 1;

  // Read current published manifest
  const latestYmlPath = path.join(releasesDir, 'mobile', 'latest.yml');
  let publishedVersion = null;
  if (fs.existsSync(latestYmlPath)) {
    try {
      const doc = YAML.parse(fs.readFileSync(latestYmlPath, 'utf-8'));
      publishedVersion = doc?.version;
    } catch {}
  }

  const tagName = `mobile-v${currentVersion}`;
  const existingTags = runGit('tag -l');
  const tagAlreadyExists = existingTags ? existingTags.split('\n').includes(tagName) : false;

  console.log(`  Local Source Version:     v${currentVersion} (build ${currentVersionCode})`);
  console.log(`  Published Manifest Version: v${publishedVersion || 'none'}`);
  console.log(`  Git Release Tag (${tagName}): ${tagAlreadyExists ? 'Already Exists' : 'Not Yet Created'}`);

  // Check if version is already published
  if (currentVersion === publishedVersion && tagAlreadyExists && !force) {
    console.log(`\n  ℹ️ Mobile v${currentVersion} is already released and up to date on SubhamCrid/furina-releases.`);
    console.log('     No version change detected. Skipping mobile release.');
    return { target: 'mobile', status: 'skipped', reason: 'Already released and up to date', version: currentVersion };
  }

  // Check if build artifacts exist
  const mobileBuildsDir = path.join(mobileDir, 'builds', `v${currentVersion}`);
  if (!fs.existsSync(mobileBuildsDir)) {
    console.log(`\n  ❌ Mobile version is set to v${currentVersion}, but build artifacts were not found at:`);
    console.log(`     ${mobileBuildsDir}`);
    console.log(`     Please run 'pnpm build:release:mobile' first to build and sign APKs offline.`);
    return { target: 'mobile', status: 'error', reason: 'Artifacts missing. Run pnpm build:release:mobile first.', version: currentVersion };
  }

  const apkFiles = fs.readdirSync(mobileBuildsDir).filter((f) => f.endsWith('.apk'));
  if (apkFiles.length === 0) {
    console.log(`\n  ❌ No APK files found in ${mobileBuildsDir}.`);
    console.log(`     Please run 'pnpm build:release:mobile' first.`);
    return { target: 'mobile', status: 'error', reason: 'No APKs in build directory', version: currentVersion };
  }

  console.log(`\n  🔍 Found ${apkFiles.length} APK artifacts ready for release.`);

  // Process APK files and construct manifest
  const manifestAssets = {};
  const sha256Lines = [];

  for (const apkFile of apkFiles) {
    const fullPath = path.join(mobileBuildsDir, apkFile);
    let abi = 'universal';
    if (apkFile.includes('arm64-v8a')) abi = 'arm64-v8a';
    else if (apkFile.includes('armeabi-v7a')) abi = 'armeabi-v7a';
    else if (apkFile.includes('x86_64')) abi = 'x86_64';
    else if (apkFile.includes('universal')) abi = 'universal';

    const sha256 = calculateSha256(fullPath);
    const sizeBytes = fs.statSync(fullPath).size;
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);

    sha256Lines.push(`${sha256}  ${apkFile}`);

    manifestAssets[abi] = {
      abi,
      fileName: apkFile,
      downloadUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tagName}/${apkFile}`,
      fallbackUrls: [
        `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@${tagName}/mobile/bin/${apkFile}`,
      ],
      sizeBytes,
      sizeMB: `${sizeMB} MB`,
      sha256,
    };
  }

  // Ensure 'universal' in the manifest maps to arm64-v8a if available.
  // This guarantees that devices with unpopulated Platform.constants or older app builds
  // receive the optimized ~28MB arm64-v8a build rather than the ~75MB universal package.
  if (manifestAssets['arm64-v8a']) {
    manifestAssets['universal'] = {
      ...manifestAssets['arm64-v8a'],
      abi: 'arm64-v8a',
    };
  }

  const newMobileManifest = {
    version: currentVersion,
    versionCode: currentVersionCode,
    publishedAt: new Date().toISOString(),
    minSupportedVersion: '1.0.0',
    isCritical: false,
    changelog: `### What's New in v${currentVersion}\n- Native performance improvements\n- High-speed video playback & stream optimizations\n- Bug fixes and stability enhancements`,
    assets: manifestAssets,
  };

  if (dryRun) {
    console.log('  [DRY-RUN] Manifest generated. Skipping file writes and git push.');
    return { target: 'mobile', status: 'simulated', version: currentVersion };
  }

  // Archive previous manifest if exists
  if (publishedVersion && publishedVersion !== currentVersion) {
    const historyDir = path.join(releasesDir, 'mobile', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    if (fs.existsSync(latestYmlPath)) {
      fs.copyFileSync(latestYmlPath, path.join(historyDir, `v${publishedVersion}.yml`));
    }
  }

  // Write new latest.yml
  fs.writeFileSync(latestYmlPath, YAML.stringify(newMobileManifest));
  console.log(`  📝 Updated: releases/mobile/latest.yml`);

  // Update releases/version.json
  updateVersionJson('mobile', {
    version: currentVersion,
    versionCode: currentVersionCode,
    tag: tagName,
    publishedAt: newMobileManifest.publishedAt,
    manifestUrl: `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@main/mobile/latest.yml`,
  });

  // Append SHA256SUMS.txt
  appendSha256Sums(sha256Lines);

  // 1. Ensure source repo (mobile) version changes are committed and pushed
  const mobileGitStatus = runGit('status --porcelain', mobileDir);
  if (mobileGitStatus && (mobileGitStatus.includes('package.json') || mobileGitStatus.includes('app.json'))) {
    console.log('\n  📦 Staging and committing source version bump in mobile repo...');
    runGit('add package.json app.json', mobileDir);
    runGit(`commit -m "chore(release): bump mobile version to v${currentVersion} (build ${currentVersionCode})"`, mobileDir);
  }
  const unpushedMobile = runGit('cherry -v', mobileDir);
  if (unpushedMobile && unpushedMobile.trim().length > 0) {
    const branch = runGit('branch --show-current', mobileDir) || 'main';
    console.log(`  🚀 Pushing source repository commits to SubhamCrid/furina-mobile (${branch})...`);
    runGit(`push origin ${branch}`, mobileDir);
  }

  // 2. Commit and Push Release Repository Manifests
  console.log('\n  📦 Staging and committing release manifest to git...');
  runGit('add mobile/ version.json SHA256SUMS.txt README.md');
  runGit(`commit -m "release(mobile): v${currentVersion} [skip ci]"`);

  if (!tagAlreadyExists) {
    runGit(`tag -a ${tagName} -m "Release Furina Mobile v${currentVersion}"`);
  }

  console.log('  🚀 Pushing commit and tag to SubhamCrid/furina-releases...');
  runGit('push origin main');
  runGit(`push origin ${tagName}`);

  // Create GitHub Release and Upload Assets
  if (GITHUB_TOKEN) {
    console.log(`\n  🌟 Creating GitHub Release: ${tagName}...`);
    try {
      const releaseResponse = await githubApiRequest('/releases', 'POST', {
        tag_name: tagName,
        name: `Furina Mobile v${currentVersion}`,
        body: newMobileManifest.changelog,
        draft: false,
        prerelease: false,
      });

      const uploadUrl = releaseResponse.upload_url;
      if (uploadUrl) {
        for (const apkFile of apkFiles) {
          const filePath = path.join(mobileBuildsDir, apkFile);
          await uploadReleaseAsset(uploadUrl, filePath, apkFile);
        }
      }
    } catch (err) {
      console.warn(`  ⚠️ GitHub Release creation/upload warning: ${err.message}`);
    }
  } else {
    console.log('  ⚠️ GITHUB_TOKEN not provided. Git commit & tags pushed, but GitHub Release creation was skipped.');
    console.log('     Add GITHUB_TOKEN to releases/.env to enable automatic GitHub Release asset uploads.');
  }

  // Purge CDN
  await purgeCdnFiles(['mobile/latest.yml', 'version.json']);

  console.log(`\n  ✅ Furina Mobile v${currentVersion} successfully released!`);
  return { target: 'mobile', status: 'published', version: currentVersion };
}

/**
 * ============================================================================
 * SOFTWARE (DESKTOP) RELEASE HANDLER
 * ============================================================================
 */
async function processSoftwareRelease() {
  console.log('\n--- [2/2] Evaluating Software Target (Furina Desktop) ---');

  const softwareDir = path.join(repoRoot, 'software');
  const softwarePackageJsonPath = path.join(softwareDir, 'package.json');

  if (!fs.existsSync(softwarePackageJsonPath)) {
    console.log('⚠️ Software directory not found. Skipping.');
    return { target: 'software', status: 'skipped', reason: 'Directory not found' };
  }

  const softwarePackage = JSON.parse(fs.readFileSync(softwarePackageJsonPath, 'utf-8'));
  const currentVersion = softwarePackage.version || '1.0.0';

  // Read current published manifest
  const latestYmlPath = path.join(releasesDir, 'software', 'latest.yml');
  let publishedVersion = null;
  if (fs.existsSync(latestYmlPath)) {
    try {
      const doc = YAML.parse(fs.readFileSync(latestYmlPath, 'utf-8'));
      publishedVersion = doc?.version;
    } catch {}
  }

  const tagName = `software-v${currentVersion}`;
  const existingTags = runGit('tag -l');
  const tagAlreadyExists = existingTags ? existingTags.split('\n').includes(tagName) : false;

  console.log(`  Local Source Version:       v${currentVersion}`);
  console.log(`  Published Manifest Version:   v${publishedVersion || 'none'}`);
  console.log(`  Git Release Tag (${tagName}): ${tagAlreadyExists ? 'Already Exists' : 'Not Yet Created'}`);

  if (currentVersion === publishedVersion && tagAlreadyExists && !force) {
    console.log(`\n  ℹ️ Software v${currentVersion} is already released and up to date on SubhamCrid/furina-releases.`);
    console.log('     No version change detected. Skipping software release.');
    return { target: 'software', status: 'skipped', reason: 'Already released and up to date', version: currentVersion };
  }

  // Check if build artifacts exist
  const softwareReleaseDir = path.join(softwareDir, 'release');
  if (!fs.existsSync(softwareReleaseDir)) {
    console.log(`\n  ❌ Software version is set to v${currentVersion}, but build artifacts were not found at:`);
    console.log(`     ${softwareReleaseDir}`);
    console.log(`     Please run 'pnpm build:release:software' first to package your desktop app offline.`);
    return { target: 'software', status: 'error', reason: 'Artifacts missing. Run pnpm build:release:software first.', version: currentVersion };
  }

  const releaseFiles = fs.readdirSync(softwareReleaseDir);
  const setupExe = releaseFiles.find((f) => f.includes(`Setup-${currentVersion}`) && f.endsWith('.exe')) ||
                   releaseFiles.find((f) => f.includes('Setup') && f.endsWith('.exe'));

  if (!setupExe) {
    console.log(`\n  ❌ Setup executable for v${currentVersion} not found in ${softwareReleaseDir}.`);
    console.log(`     Please run 'pnpm build:release:software' first.`);
    return { target: 'software', status: 'error', reason: 'Setup executable missing', version: currentVersion };
  }

  const setupExePath = path.join(softwareReleaseDir, setupExe);
  const setupSha512 = calculateSha512Base64(setupExePath);
  const setupSha256 = calculateSha256(setupExePath);
  const setupSizeBytes = fs.statSync(setupExePath).size;

  const downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tagName}/${setupExe}`;

  const newSoftwareManifest = {
    version: currentVersion,
    files: [
      {
        url: downloadUrl,
        sha512: setupSha512,
        size: setupSizeBytes,
      },
    ],
    path: downloadUrl,
    sha512: setupSha512,
    releaseDate: new Date().toISOString(),
  };

  if (dryRun) {
    console.log('  [DRY-RUN] Manifest generated. Skipping file writes and git push.');
    return { target: 'software', status: 'simulated', version: currentVersion };
  }

  // Archive previous manifest if exists
  if (publishedVersion && publishedVersion !== currentVersion) {
    const historyDir = path.join(releasesDir, 'software', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    if (fs.existsSync(latestYmlPath)) {
      fs.copyFileSync(latestYmlPath, path.join(historyDir, `v${publishedVersion}.yml`));
    }
  }

  // Write new latest.yml
  fs.writeFileSync(latestYmlPath, YAML.stringify(newSoftwareManifest));
  console.log(`  📝 Updated: releases/software/latest.yml`);

  // Update releases/version.json
  updateVersionJson('software', {
    version: currentVersion,
    tag: tagName,
    publishedAt: newSoftwareManifest.releaseDate,
    manifestUrl: `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@main/software/latest.yml`,
    setupUrl: downloadUrl,
  });

  // Append checksums
  appendSha256Sums([`${setupSha256}  ${setupExe}`]);

  // 1. Ensure source repo (software) version changes are committed and pushed
  const softwareGitStatus = runGit('status --porcelain', softwareDir);
  if (softwareGitStatus && softwareGitStatus.includes('package.json')) {
    console.log('\n  📦 Staging and committing source version bump in software repo...');
    runGit('add package.json', softwareDir);
    runGit(`commit -m "chore(release): bump desktop version to v${currentVersion}"`, softwareDir);
  }
  const unpushedSoftware = runGit('cherry -v', softwareDir);
  if (unpushedSoftware && unpushedSoftware.trim().length > 0) {
    const branch = runGit('branch --show-current', softwareDir) || 'main';
    console.log(`  🚀 Pushing source repository commits to SubhamCrid/furina-software (${branch})...`);
    runGit(`push origin ${branch}`, softwareDir);
  }

  // 2. Commit and Push Release Repository Manifests
  console.log('\n  📦 Staging and committing release manifest to git...');
  runGit('add software/ version.json SHA256SUMS.txt README.md');
  runGit(`commit -m "release(software): v${currentVersion} [skip ci]"`);

  if (!tagAlreadyExists) {
    runGit(`tag -a ${tagName} -m "Release Furina Desktop v${currentVersion}"`);
  }

  console.log('  🚀 Pushing commit and tag to SubhamCrid/furina-releases...');
  runGit('push origin main');
  runGit(`push origin ${tagName}`);

  // Create GitHub Release and Upload Assets
  if (GITHUB_TOKEN) {
    console.log(`\n  🌟 Creating GitHub Release: ${tagName}...`);
    try {
      const releaseResponse = await githubApiRequest('/releases', 'POST', {
        tag_name: tagName,
        name: `Furina Desktop v${currentVersion}`,
        body: `### Furina Desktop v${currentVersion}\n- Production release\n- Full embedded streaming proxy & player enhancements`,
        draft: false,
        prerelease: false,
      });

      const uploadUrl = releaseResponse.upload_url;
      if (uploadUrl) {
        // Upload setup exe
        await uploadReleaseAsset(uploadUrl, setupExePath, setupExe);

        // Upload blockmap if exists
        const blockmapFile = `${setupExe}.blockmap`;
        const blockmapPath = path.join(softwareReleaseDir, blockmapFile);
        if (fs.existsSync(blockmapPath)) {
          await uploadReleaseAsset(uploadUrl, blockmapPath, blockmapFile);
        }

        // Upload portable exe if exists
        const portableExe = releaseFiles.find((f) => f.includes('portable') && f.endsWith('.exe'));
        if (portableExe) {
          await uploadReleaseAsset(uploadUrl, path.join(softwareReleaseDir, portableExe), portableExe);
        }
      }
    } catch (err) {
      console.warn(`  ⚠️ GitHub Release creation/upload warning: ${err.message}`);
    }
  } else {
    console.log('  ⚠️ GITHUB_TOKEN not provided. Git commit & tags pushed, but GitHub Release creation was skipped.');
    console.log('     Add GITHUB_TOKEN to releases/.env to enable automatic GitHub Release asset uploads.');
  }

  // Purge CDN
  await purgeCdnFiles(['software/latest.yml', 'version.json']);

  console.log(`\n  ✅ Furina Desktop v${currentVersion} successfully released!`);
  return { target: 'software', status: 'published', version: currentVersion };
}

/**
 * Version JSON Helper
 */
function updateVersionJson(platform, data) {
  const versionJsonPath = path.join(releasesDir, 'version.json');
  let current = {};
  if (fs.existsSync(versionJsonPath)) {
    try {
      current = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
    } catch {}
  }

  current.updatedAt = new Date().toISOString();
  current[platform] = { ...current[platform], ...data };

  fs.writeFileSync(versionJsonPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`  📝 Updated: releases/version.json (${platform})`);
}

/**
 * Append Checksums Helper
 */
function appendSha256Sums(newLines = []) {
  if (newLines.length === 0) return;
  const sumsPath = path.join(releasesDir, 'SHA256SUMS.txt');
  let existing = '';
  if (fs.existsSync(sumsPath)) {
    existing = fs.readFileSync(sumsPath, 'utf-8');
  }

  const existingLines = new Set(existing.split('\n').map((l) => l.trim()).filter(Boolean));
  for (const line of newLines) {
    existingLines.add(line.trim());
  }

  fs.writeFileSync(sumsPath, Array.from(existingLines).join('\n') + '\n');
  console.log(`  📝 Updated: releases/SHA256SUMS.txt (+${newLines.length} entries)`);
}

/**
 * Main Controller
 */
async function main() {
  const report = [];

  if (targetArg === 'mobile' || targetArg === 'all') {
    const res = await processMobileRelease();
    report.push(res);
  }

  if (targetArg === 'software' || targetArg === 'all') {
    const res = await processSoftwareRelease();
    report.push(res);
  }

  console.log('\n====================================================');
  console.log('📊 RELEASE EXECUTION SUMMARY');
  console.log('====================================================');
  console.table(report);

  const hasErrors = report.some((r) => r.status === 'error');
  if (hasErrors) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 Unexpected release error:', err);
  process.exit(1);
});

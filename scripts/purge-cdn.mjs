#!/usr/bin/env node

/**
 * jsDelivr Edge CDN Invalidation Script
 * Sends purge requests to immediately invalidate CDN caches globally.
 */

const REPO_OWNER = 'SubhamCrid';
const REPO_NAME = 'furina-releases';
const BRANCH = 'main';

export async function purgeCdnFiles(files = []) {
  if (files.length === 0) {
    files = ['mobile/latest.yml', 'software/latest.yml', 'version.json'];
  }

  console.log('⚡ Purging jsDelivr Edge CDN Cache for updated manifests...');
  const results = [];

  for (const file of files) {
    const purgeUrl = `https://purge.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${BRANCH}/${file}`;
    try {
      const response = await fetch(purgeUrl, { method: 'GET' });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        console.log(`  ✅ Purged: ${file} (status: ${data.status || 'success'})`);
        results.push({ file, success: true });
      } else {
        console.warn(`  ⚠️ Warning: Failed to purge ${file} (HTTP ${response.status})`);
        results.push({ file, success: false, status: response.status });
      }
    } catch (err) {
      console.warn(`  ⚠️ Network error purging ${file}:`, err.message);
      results.push({ file, success: false, error: err.message });
    }
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('purge-cdn.mjs')) {
  const customFiles = process.argv.slice(2);
  purgeCdnFiles(customFiles);
}

#!/usr/bin/env node

/**
 * Health Verification Script for CDN Endpoints
 * Checks HTTP status, latency, and content accessibility across mirrors.
 */

import YAML from 'yaml';

const REPO_OWNER = 'SubhamCrid';
const REPO_NAME = 'furina-releases';
const BRANCH = 'main';

const endpoints = [
  {
    name: 'Mobile (jsDelivr Edge)',
    url: `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${BRANCH}/mobile/latest.yml?t=${Date.now()}`,
    type: 'yaml',
  },
  {
    name: 'Mobile (Raw GitHub Fallback)',
    url: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/mobile/latest.yml?t=${Date.now()}`,
    type: 'yaml',
  },
  {
    name: 'Software (jsDelivr Edge)',
    url: `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${BRANCH}/software/latest.yml?t=${Date.now()}`,
    type: 'yaml',
  },
  {
    name: 'Software (Raw GitHub Fallback)',
    url: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/software/latest.yml?t=${Date.now()}`,
    type: 'yaml',
  },
  {
    name: 'Unified version.json (jsDelivr)',
    url: `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${BRANCH}/version.json?t=${Date.now()}`,
    type: 'json',
  },
];

async function verifyEndpoint(ep) {
  const start = performance.now();
  try {
    const res = await fetch(ep.url, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      return {
        Endpoint: ep.name,
        Status: `HTTP ${res.status}`,
        Latency: `${latency}ms`,
        Version: 'N/A',
        Health: '❌ Unhealthy',
      };
    }

    const text = await res.text();
    let version = 'unknown';

    if (ep.type === 'yaml') {
      const parsed = YAML.parse(text);
      version = parsed?.version || 'parsed';
    } else if (ep.type === 'json') {
      const parsed = JSON.parse(text);
      version = `M:${parsed?.mobile?.version || '?'} S:${parsed?.software?.version || '?'}`;
    }

    return {
      Endpoint: ep.name,
      Status: `HTTP ${res.status}`,
      Latency: `${latency}ms`,
      Version: `v${version}`,
      Health: '✅ Healthy',
    };
  } catch (err) {
    return {
      Endpoint: ep.name,
      Status: 'Error',
      Latency: 'N/A',
      Version: 'N/A',
      Health: `❌ ${err.message}`,
    };
  }
}

async function main() {
  console.log('🔍 Verifying Global CDN & Fallback Health for SubhamCrid/furina-releases...\n');
  const results = [];

  for (const ep of endpoints) {
    const r = await verifyEndpoint(ep);
    results.push(r);
  }

  console.table(results);
}

main().catch(console.error);

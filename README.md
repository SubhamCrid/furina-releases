# Furina Official Releases (Mobile & Desktop)

[![Releases](https://img.shields.io/github/v/release/SubhamCrid/furina-releases?style=for-the-badge&color=8b5cf6)](https://github.com/SubhamCrid/furina-releases/releases)
[![CDN Status](https://img.shields.io/badge/CDN-jsDelivr%20Global-success?style=for-the-badge&logo=jsdelivr)](https://cdn.jsdelivr.net/gh/SubhamCrid/furina-releases@main/version.json)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

Official distribution repository and edge-CDN manifests for **Furina Mobile (Android)** and **Furina Desktop (Windows)**.

---

## 📱 Mobile Releases (Android)

- **Latest Version:** `v1.0.16` (Build `17`)
- **Manifest:** [`mobile/latest.yml`](https://cdn.jsdelivr.net/gh/SubhamCrid/furina-releases@main/mobile/latest.yml)
- **Tag Naming:** `mobile-vX.Y.Z`

| Architecture | Package Name | Recommended Devices | Size | Checksum |
| :--- | :--- | :--- | :--- | :--- |
| **ARM64 (64-bit)** | `Furina-v1.0.16-arm64-v8a.apk` | Modern phones & tablets (2018+) | ~28.5 MB | `76e243ff...` |
| **ARMv7 (32-bit)** | `Furina-v1.0.16-armeabi-v7a.apk` | Older phones & entry TV sticks | ~23.0 MB | `28d0566b...` |
| **Universal** | `Furina-v1.0.16-universal.apk` | Compatible with all Androids | ~75.4 MB | `4dd9a3e9...` |
| **x86_64** | `Furina-v1.0.16-x86_64.apk` | Android Emulators / ChromeOS | ~29.0 MB | `6330a347...` |

---

## 💻 Software Releases (Windows Desktop)

- **Latest Version:** `v1.0.0`
- **Manifest:** [`software/latest.yml`](https://cdn.jsdelivr.net/gh/SubhamCrid/furina-releases@main/software/latest.yml)
- **Tag Naming:** `software-vX.Y.Z`

| Package | File | Size | Description |
| :--- | :--- | :--- | :--- |
| **Windows Installer** | `Furina-Setup-1.0.0.exe` | ~94.8 MB | Automatic installer with auto-updates & shortcuts |

---

## 🌐 Edge CDN Architecture & Cache Invalidation

Manifests are served from high-speed edge networks with sub-millisecond propagation:

1. **jsDelivr Edge (Primary):**  
   - Mobile: `https://cdn.jsdelivr.net/gh/SubhamCrid/furina-releases@main/mobile/latest.yml`
   - Software: `https://cdn.jsdelivr.net/gh/SubhamCrid/furina-releases@main/software/latest.yml`
2. **Raw GitHub (Direct Fallback with Cache-Buster):**  
   - `https://raw.githubusercontent.com/SubhamCrid/furina-releases/main/mobile/latest.yml`
3. **Statically CDN:**  
   - `https://cdn.staticaly.com/gh/SubhamCrid/furina-releases/main/mobile/latest.yml`

All release operations automatically invoke the jsDelivr Purge API (`POST https://purge.jsdelivr.net/...`), instantly clearing edge caches globally.

---

## 🚀 Release CLI Commands

Releases are managed from the root of the workspace or this directory:

```bash
# 1. Build locally (does NOT publish):
pnpm build:release:mobile    # Builds signed APKs locally
pnpm build:release:software  # Packages Windows Setup locally

# 2. Publish (checks changes, informs if unchanged, publishes if new):
pnpm release:all             # Inspects both targets and releases newly built versions
pnpm release:mobile          # Releases Mobile only (leaves Software untouched)
pnpm release:software        # Releases Software only (leaves Mobile untouched)
```

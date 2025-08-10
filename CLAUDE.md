# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Surge network tool repository containing modules, rules, and scripts for iOS/macOS network proxy and automation. The repository focuses on network traffic interception, cookie/token management, and automated data extraction for various Chinese services.

## Repository Structure

- **Module/**: Surge module files (.sgmodule) that define script rules and MITM hostnames
  - Main modules: VideoUrl.sgmodule, wskey.sgmodule, bsh.sgmodule
  - Backup directory contains historical/alternative modules

- **Rule/**: Network filtering rules for Surge and Clash
  - Surge format (.list) and Clash format (.yaml)
  - Main rules: surge_rules_D.list (domestic), surge_rules_P.list (proxy)
  - Clash equivalents: clash_rules_D.yaml, clash_rules_P.yaml

- **Script/**: JavaScript scripts for HTTP request/response manipulation
  - Main scripts: VideoUrl.js, wskey.js, bsh.js
  - Backup directory contains historical/alternative scripts

## Key Components

### VideoUrl Module (Module/VideoUrl.sgmodule, Script/VideoUrl.js)
- Intercepts sports record API responses from a.yufanai.com
- Analyzes jump rope data to find maximum sportCount and corresponding videoUrl
- Calculates total statistics and determines qualification status
- Uses thresholds: QUALIFIED_THRESHOLD (195), EXCELLENT_THRESHOLD (200)

### JD Wskey Module (Module/wskey.sgmodule, Script/wskey.js)
- Automatically captures JD.com WSKEY tokens and PIN values
- Handles multiple user accounts with persistent storage
- Implements caching mechanism with expiration (CACHE_EXPIRE_TIME: 15000ms)
- Features comprehensive error handling and logging system

### BSH Module (Module/bsh.sgmodule, Script/bsh.js)
- Monitors token changes in HTTP request headers
- Automatically updates persistent storage when tokens change
- Sends notifications for token updates

## Development Patterns

### Script Architecture
- Uses Surge's `$request`, `$response`, and `$persistentStore` APIs
- Implements async/await patterns for HTTP requests
- Comprehensive error handling with try/catch blocks
- Debug logging controlled by `is_debug` flag

### Common Utilities
- `Env` class: Standardized environment wrapper with logging, HTTP methods, and storage
- `objectKeys2LowerCase()`: Normalizes HTTP header keys
- Cookie extraction utilities with regex patterns
- JSON serialization/deserialization with fallbacks

### Module Configuration
- Standard header format: `#!name=`, `#!desc=`, `#!category=`, `#!system=`
- Script rules define URL patterns and script paths
- MITM sections specify hostname patterns for SSL certificate inspection

## File Naming Conventions

- Module files: `.sgmodule` extension
- Surge rules: `.list` extension  
- Clash rules: `.yaml` extension
- Script files: `.js` extension
- Backup files kept in `Backup/` subdirectories

## Data Storage

Scripts use `$persistentStore` for:
- Token persistence (bsh.js)
- Multi-user WSKEY management (wskey.js)
- Temporary caching with timestamps
- JSON serialization for complex data structures

## Network Security

All scripts implement:
- Input validation for headers and cookies
- Safe JSON parsing with error handling
- Timeout protection for HTTP requests
- Secure storage of sensitive tokens

## Common Commands

This repository doesn't use traditional build tools. Scripts are executed by Surge based on network traffic patterns. Testing involves:
- Manual testing with actual network traffic
- Debug logging via `console.log()`
- Notification testing via `$notification.post()`
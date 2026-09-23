# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-09-23

### Added
- Tests, run by the CI build job.
- README section on opencode 2, which has Ollama built in and does not load this plugin.

### Changed
- Publish to npm through trusted publishing (OIDC) instead of an `NODE_AUTH_TOKEN` secret.

### Removed
- `postinstall` script.

### Fixed
- CI pipeline. Version 0.1.1 was tagged and released but never reached npm, because the
  publish job authenticated with a repository secret that does not exist.

## [0.1.0] - 2026-04-25

### Added
- Initial release
- Native Ollama model discovery for OpenCode
- Plugin hook integration with OpenCode provider system
- Configuration support for host, baseURL, providerID, timeout, context/output limits
- Capability mapping from Ollama model metadata to OpenCode capabilities
- Changelog with Keep a Changelog format

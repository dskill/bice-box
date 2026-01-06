# CLAUDE.md - Bice-Box Project Guidelines

## Repository Structure
- **Main App**: `/Users/drew/src/bice-box` - Electron/React application
- **Effects Repository**: `/Users/drew/bice-box-effects` - Audio/visual effects
  - Contains effects (JSON), audio (SC) and visual (JS) files
  - Used by the main app at runtime

## Build/Development Commands
- `npm run dev` - Start development with hot reloading
- `npm run build:electron` - Build for standard systems

## Release Workflow (Preferred)
- `npm run release:patch:ci` - Bumps version (patch), commits, pushes with tags, and triggers GitHub Actions to build arm64 for Raspberry Pi

## Code Style Guidelines
- **React Components**: Function components with hooks pattern
- **Imports**: Group by external/internal, alphabetical order
- **Error Handling**: Try/catch blocks with descriptive error messages
- **Naming**: camelCase for variables/functions, PascalCase for components
- **Electron IPC**: Promise pattern with timeouts for IPC calls
- **Formatting**: 2-space indentation, single quotes

## Effects Repository Guidelines
- **Effects**: JSON files in `/effects` directory
- **Audio**: SuperCollider files in `/audio` directory
- **Visual**: p5.js sketch files in `/visual` directory
- **Structure**: Each effect has a JSON config linking to its audio/visual files

This project is an Audiovisual Effects Processor designed for Raspberry Pi with Electron and React that processes audio input and generates synchronized visuals.
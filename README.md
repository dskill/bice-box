# Bice-Box

An Audiovisual Effects Processor designed for Raspberry Pi systems.

## Development Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start development environment with hot-reloading:
   ```
   npm run dev
   ```

   This runs both the React development server and Electron concurrently using `dev:react` and `dev:electron` scripts.

## Building for Production

1. Package the application:
   ```
   npm run package
   ```

   For Raspberry Pi or low-memory systems:
   ```
   npm run package:pi
   ```

2. Create distributable formats:
   ```
   npm run make
   ```

3. Clean up build artifacts:
   ```
   npm run clean
   ```

## Project Structure

- React app source is in the `src` directory
- Electron main process files are in the `electron` directory
- Build output goes to the `build` directory
- Distribution files are stored in the `dist` directory
- Requires a separate Effects Repository to be available in the users home directory.

## Scripts Reference

- `npm run dev`: Runs React and Electron in development mode with hot-reloading
- `npm run build:electron`: Builds React and packages the app for standard systems
- `npm run build:electron:pi`: Builds React and packages the app for Raspberry Pi (arm64)
- `npm run release:publish`: Builds and publishes a new release for Raspberry Pi
- `npm run clean`: Removes build and packaging artifacts

## Build Information

- Targets Raspberry Pi (arm64) by default
- Packages as Linux zip file
- Includes automatic GitHub release publishing
- Output files are named in the format: Bice-Box-[version]-[architecture].[extension]
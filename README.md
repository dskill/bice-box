# Bice-Box

An Audiovisual Effects Processor designed for Raspberry Pi (but it also runs on Mac for development).

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

## Release Process

To publish a new release:

1. Update the version number (e.g., for a patch release):
   ```
   npm version patch
   ```

2. Build and publish the new release:
   ```
   npm run release:publish
   ```

This will automatically handle building for Raspberry Pi, creating a GitHub release, and uploading the artifact.

**Note on Tag Conflicts:**

`npm version` creates a local tag, while `release:publish` may create a tag on the remote (GitHub). If you pull changes after a release, you might see a `rejected ... (would clobber existing tag)` error.

To resolve this:

1. Delete the local tag:
   ```
   git tag -d <tag_name>  # e.g., git tag -d v0.1.42
   ```
2. Fetch the correct tag from the remote:
   ```
   git fetch origin --tags
   ```
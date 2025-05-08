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

The following process is designed to prevent Git tag conflicts that can occur if local and remote tags are created with different properties (e.g., lightweight vs. annotated).

To publish a new release:

1.  Update the version number in `package.json` and create an annotated Git tag:
    ```bash
    npm version patch -m "chore(release): version %s"
    ```
    Replace `patch` with `minor` or `major` as appropriate for your release (e.g., `npm version minor -m "feat(release): version %s"`). The `-m "..."` part is crucial as it creates an annotated tag, which is preferred for releases. The `%s` in the message will be automatically replaced with the new version number.

2.  Push the new commit (created by `npm version`) and its associated annotated tag to your remote repository:
    ```bash
    git push --follow-tags
    ```
    This command pushes the current branch to its configured upstream remote repository, along with any annotated tags on the commits being pushed. Ensure your current branch is set up to push to the correct remote (e.g., `origin`) and branch.

3.  Build and publish the new release:
    ```bash
    npm run release:publish
    ```

This revised process ensures that the annotated tag you create locally is pushed to the remote *before* the `release:publish` script (which uses `electron-builder`) runs. The `electron-builder` tool should then use this existing tag when creating the GitHub release, thereby avoiding conflicts that might arise from differing local and remote tag objects for the same version. This should make subsequent `git pull` operations smoother without tag clobbering issues.
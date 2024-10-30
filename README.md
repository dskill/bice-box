# Bice-Box

## Development Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start development environment with hot-reloading:
   ```
   npm start
   ```

   This runs both the React development server and Electron concurrently using `start:react` and `start:electron` scripts.

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
- Electron main process file is `main.js` in the root directory
- Build output goes to the `build` directory
- Build artifacts are stored in the `out` directory
- Requires a separate Effects Repository to be available in the users home directory.

## Scripts Reference

- `npm start`: Runs React and Electron in development mode with hot-reloading
- `npm run package`: Builds React and packages the app
- `npm run package:pi`: Builds React and packages the app for Raspberry Pi
- `npm run clean`: Removes build and packaging artifacts
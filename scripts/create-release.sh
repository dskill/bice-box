#!/bin/bash

# Ensure we're in the project root
cd "$(dirname "$0")/.."

# Get the current version from package.json
VERSION=$(node -p "require('./package.json').version")

npm run clean

# Determine platform-specific name
if [[ "$OSTYPE" == "linux-gnueabihf" ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="pi"
    npm run package:pi
else
    PLATFORM="mac"

    npm run package
fi

# Create a zip file of the build with platform-specific name
cd out
zip -r "../bice-box-${VERSION}-${PLATFORM}.zip" ./*
cd ..

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI (gh) is not installed. Please install it first."
    exit 1
fi

# Create or update release on GitHub
echo "Creating/updating GitHub release v${VERSION}..."
if gh release view "v${VERSION}" &> /dev/null; then
    # Release exists, update it
    gh release upload "v${VERSION}" "bice-box-${VERSION}-${PLATFORM}.zip" --clobber
else
    # Create new release
    gh release create "v${VERSION}" \
        --title "Bice-Box v${VERSION}" \
        --notes "Release v${VERSION}" \
        "bice-box-${VERSION}-${PLATFORM}.zip"
fi

# Clean up
rm "bice-box-${VERSION}-${PLATFORM}.zip"
echo "Release v${VERSION} created successfully!" 
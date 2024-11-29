#!/bin/bash

# Configuration
APP_NAME="Bice-Box"
GITHUB_REPO="dskill/bice-box"
INSTALL_DIR="$HOME/$APP_NAME"

echo "🎵 Installing $APP_NAME..."

# Detect OS and Architecture
OS=$(uname -s)
ARCH=$(uname -m)

# Determine which build to download
case "$OS" in
    "Darwin")
        if [ "$ARCH" = "arm64" ]; then
            echo "🍎 Detected Mac ARM64 (Apple Silicon)"
            echo "❌ Please download the DMG manually from: https://github.com/$GITHUB_REPO/releases"
            exit 1
        else
            echo "❌ This application only supports Apple Silicon Macs"
            exit 1
        fi
        ;;
    "Linux")
        if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            BUILD_SUFFIX="-arm64.zip"
            echo "🍓 Detected Linux ARM64 (Raspberry Pi)"
        else
            echo "❌ This application only supports Raspberry Pi (ARM64)"
            exit 1
        fi
        ;;
    *)
        echo "❌ Unsupported operating system: $OS"
        exit 1
        ;;
esac

# Get the latest release version
echo "🔍 Checking for latest version..."
LATEST_VERSION=$(curl -s https://api.github.com/repos/$GITHUB_REPO/releases/latest | grep "tag_name" | cut -d '"' -f 4)

if [ -z "$LATEST_VERSION" ]; then
    echo "❌ Error: Could not fetch latest version"
    exit 1
fi

echo "📦 Downloading version $LATEST_VERSION..."

# Download the appropriate file
DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_VERSION/$APP_NAME-${LATEST_VERSION#v}$BUILD_SUFFIX"
TMP_FILE="/tmp/$APP_NAME$BUILD_SUFFIX"

curl -L $DOWNLOAD_URL -o "$TMP_FILE"

if [ ! -f "$TMP_FILE" ]; then
    echo "❌ Error: Download failed"
    exit 1
fi

# Create installation directory
echo "📂 Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Unzip the application
echo "📤 Extracting files..."
unzip -o "$TMP_FILE" -d "$INSTALL_DIR"

# Clean up
echo "🧹 Cleaning up..."
rm "$TMP_FILE"

echo "✅ Installation complete! You can find $APP_NAME in $INSTALL_DIR"
echo "🚀 To run the application, use: $INSTALL_DIR/$APP_NAME" 
#!/bin/bash

# Configuration
APP_NAME="bice-box"
GITHUB_REPO="dskill/bice-box"
INSTALL_DIR="$HOME/$APP_NAME"

# Add command line argument parsing
RUN_AFTER_INSTALL=false
while getopts "r" flag; do
    case "${flag}" in
        r) RUN_AFTER_INSTALL=true ;;
    esac
done

echo ">> Installing $APP_NAME..."

# Detect OS and Architecture
OS=$(uname -s)
ARCH=$(uname -m)

# Determine which build to download
case "$OS" in
    "Darwin")
        if [ "$ARCH" = "arm64" ]; then
            echo ">> Detected Mac ARM64 (Apple Silicon)"
            echo "!! Please download the DMG manually from: https://github.com/$GITHUB_REPO/releases"
            exit 1
        else
            echo "!! This application only supports Apple Silicon Macs"
            exit 1
        fi
        ;;
    "Linux")
        if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            BUILD_SUFFIX="-arm64.zip"
            echo ">> Detected Linux ARM64 (Raspberry Pi)"
        else
            echo "!! This application only supports Raspberry Pi (ARM64)"
            exit 1
        fi
        ;;
    *)
        echo "!! Unsupported operating system: $OS"
        exit 1
        ;;
esac

# Function to compare version strings
version_compare() {
    if [[ $1 == $2 ]]; then
        echo "equal"
    else
        if [[ $1 = "$(echo -e "$1\n$2" | sort -V | head -n1)" ]]; then
            echo "smaller"
        else
            echo "greater"
        fi
    fi
}

# Check if app is already installed and get current version
CURRENT_VERSION=""
if [ -f "$INSTALL_DIR/$APP_NAME" ]; then
    CURRENT_VERSION=$("$INSTALL_DIR/$APP_NAME" --version 2>/dev/null || echo "")
    echo ">> Current version: ${CURRENT_VERSION:-unknown}"
fi

# Get the latest release version
echo ">> Checking for latest version..."
LATEST_VERSION=$(curl -s https://api.github.com/repos/$GITHUB_REPO/releases/latest | grep "tag_name" | cut -d '"' -f 4)

if [ -z "$LATEST_VERSION" ]; then
    echo "!! Error: Could not fetch latest version"
    exit 1
fi

echo ">> Latest version: $LATEST_VERSION"

# Compare versions and decide whether to update
if [ ! -z "$CURRENT_VERSION" ]; then
    COMPARE_RESULT=$(version_compare "${CURRENT_VERSION#v}" "${LATEST_VERSION#v}")
    if [ "$COMPARE_RESULT" = "equal" ]; then
        echo ">> You already have the latest version installed!"
        if [ "$RUN_AFTER_INSTALL" = true ]; then
            echo "[INFO] Starting $APP_NAME..."
            "$INSTALL_DIR/$APP_NAME"
        else
            echo "[INFO] To run the application, use: $INSTALL_DIR/$APP_NAME"
        fi
        exit 0
    elif [ "$COMPARE_RESULT" = "greater" ]; then
        echo "!! Your installed version is newer than the latest release"
        if [ "$RUN_AFTER_INSTALL" = true ]; then
            echo "[INFO] Starting $APP_NAME..."
            "$INSTALL_DIR/$APP_NAME"
        else
            echo "[INFO] To run the application, use: $INSTALL_DIR/$APP_NAME"
        fi
        exit 0
    fi
    echo ">> Updating to newer version..."
else
    echo ">> Installing new version..."
fi

echo ">> Downloading version $LATEST_VERSION..."

# Download the appropriate file
DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_VERSION/$APP_NAME-${LATEST_VERSION#v}$BUILD_SUFFIX"
TMP_FILE="/tmp/$APP_NAME$BUILD_SUFFIX"

curl -L $DOWNLOAD_URL -o "$TMP_FILE"

if [ ! -f "$TMP_FILE" ]; then
    echo "!! Error: Download failed"
    exit 1
fi

# Create installation directory
echo ">> Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Unzip the application
echo ">> Extracting files..."
unzip -o "$TMP_FILE" -d "$INSTALL_DIR"

# Clean up
echo ">> Cleaning up..."
rm "$TMP_FILE"

echo "[INFO] Installation complete! You can find $APP_NAME in $INSTALL_DIR"
if [ "$RUN_AFTER_INSTALL" = true ]; then
    echo "[INFO] Starting $APP_NAME..."
    "$INSTALL_DIR/$APP_NAME"
else
    echo "[INFO] To run the application, use: $INSTALL_DIR/$APP_NAME"
fi 
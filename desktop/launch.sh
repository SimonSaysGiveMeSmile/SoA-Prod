#!/bin/bash

# Son of Anton Launcher
# This script launches Son of Anton from anywhere

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the project directory
cd "$SCRIPT_DIR"

# Kill any existing instances
pkill -f "Electron src" 2>/dev/null

# Launch Son of Anton
echo "🚀 Launching Son of Anton..."
./node_modules/.bin/electron src --no-sandbox

#!/bin/bash

# Cleanup previous instances
echo "🔄 Killing stale processes..."
pkill -f electron 2>/dev/null || true

# Kill any process using port 3000
PORT_PID=$(lsof -ti:3000 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
    echo "   Killing process on port 3000 (PID: $PORT_PID)..."
    kill -9 $PORT_PID 2>/dev/null || true
fi

# Launch
echo "🚀 Launching Son of Anton..."
./node_modules/.bin/electron src --no-sandbox

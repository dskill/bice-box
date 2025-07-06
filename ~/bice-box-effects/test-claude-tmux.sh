#!/bin/bash

# Test script to determine which tmux send method works best with Claude
# Run this after starting a Claude session to test different approaches

SESSION_NAME="claude-bice-box"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Error: Claude session not running. Start it with './claude-persistent.sh start'"
    exit 1
fi

echo "Testing different tmux send methods with Claude..."
echo "Watch the Claude session to see which method executes commands vs just adds line breaks."
echo ""

echo "Test 1: Double Return"
tmux send-keys -t "$SESSION_NAME" "echo 'Test 1: Double Return'" Return Return
sleep 2

echo "Test 2: Ctrl+M (carriage return)"
tmux send-keys -t "$SESSION_NAME" "echo 'Test 2: Ctrl+M'" C-m C-m
sleep 2

echo "Test 3: C-j (line feed)"
tmux send-keys -t "$SESSION_NAME" "echo 'Test 3: Line feed'" C-j C-j
sleep 2
xxa
echo "Test 4: Force with Ctrl+C first"
tmux send-keys -t "$SESSION_NAME" C-c
sleep 0.1
tmux send-keys -t "$SESSION_NAME" "echo 'Test 4: Force method'" C-m C-m
sleep 2

echo "Test 5: Triple Return (aggressive)"
tmux send-keys -t "$SESSION_NAME" "echo 'Test 5: Triple Return'" Return Return Return
sleep 2

echo ""
echo "Testing complete. Check the Claude session to see which methods actually executed the commands."
echo "Use the method that worked best with your Claude session." 
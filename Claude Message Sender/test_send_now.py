#!/usr/bin/env python3
"""
Test script to send a message to Claude immediately.
This bypasses the scheduler and calls the ask_claude function directly.
"""

import subprocess
import random
from datetime import datetime

# Import the necessary variables from the main script
import claude_message_send_with_CC_CLI as main_script

def ask_claude_test():
    """Ask Claude a question using CLI (standalone version for testing)"""
    question = random.choice(main_script.QUESTIONS)
    current_time = datetime.now().strftime("%H:%M:%S")
    
    print(f"\n[{current_time}] Asking Claude:")
    print(f"Q: {question}")
    print("-" * 50)
    
    try:
        # Run claude command with -p flag and model
        # Run from an isolated temp directory to avoid loading project context
        import tempfile
        import os
        isolated_dir = os.path.join(tempfile.gettempdir(), "claude_isolated")
        os.makedirs(isolated_dir, exist_ok=True)
        
        result = subprocess.run(
            main_script.CLAUDE_COMMAND + ["--model", main_script.CLAUDE_MODEL, "-p", question],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=isolated_dir  # Run from isolated directory
        )
        
        if result.returncode == 0:
            response = result.stdout.strip()
            print(f"A: {response}")
        else:
            error_message = result.stderr.strip()
            if not error_message:
                error_message = result.stdout.strip()
            print(f"✗ Error: {error_message}")
            
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("Status: Finished run.")

def main():
    print("=" * 50)
    print("Test Script - Sending message to Claude NOW")
    print("=" * 50)
    print(f"Using model: {main_script.CLAUDE_MODEL}")
    print(f"Available questions: {len(main_script.QUESTIONS)}")
    print("=" * 50)
    
    # Call our standalone test function
    ask_claude_test()
    
    print("\n" + "=" * 50)
    print("Test complete!")
    print("=" * 50)

if __name__ == "__main__":
    main()

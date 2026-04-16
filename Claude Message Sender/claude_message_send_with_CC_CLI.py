#!/usr/bin/env python3
"""
Simple Claude CLI Question Asker (revised)
Asks Claude a coding question using the CLI.
Runs every day at a set start time and fixed hourly interval.
"""

import subprocess
import time
from datetime import datetime, timedelta
import schedule
import random
import bisect

# User-configurable settings
# Path to the Claude CLI executable.
CLAUDE_COMMAND = ["claude"]
CLAUDE_MODEL = "haiku"    # Model alias: "sonnet", "opus", or "haiku" (or full model name)
start_time = "05:05"      # 24-hour format
interval_hours = 5        # hours between runs

# Simple coding questions
QUESTIONS = [
    "What is the best method to incorporate with a database in Python? (Answer in 1 sentence.)",
    "What are 3 key principles for writing clean code? (Answer in 1 sentence.)",
    "How should I structure error handling in Python? (Answer in 1 sentence.)",
    "What are best practices for API design? (Answer in 1 sentence.)",
    "How do you implement proper logging? (Answer in 1 sentence.)",
    "What are secure coding practices? (Answer in 1 sentence.)",
    "How should I organize a Python project? (Answer in 1 sentence.)",
    "What are testing best practices? (Answer in 1 sentence.)",
    "How do you optimize database queries? (Answer in 1 sentence.)",
    "What design patterns should I know? (Answer in 1 sentence.)",
]

# -------------------------------------------------------------------

# Global variable to store daily times
scheduled_times = []

def generate_daily_times(start_str: str, step_hours: int) -> list[str]:
    """Return a list of HH:MM strings for all runs in one day."""
    print(f"Generating daily schedule starting at {start_str} with {step_hours}-hour intervals...")
    
    # Parse the start time
    start_hour, start_minute = map(int, start_str.split(':'))
    
    times = []
    current_hour = start_hour
    current_minute = start_minute
    
    # Generate times for 24 hours
    for _ in range(24 // step_hours + 1):
        # Format the current time
        time_str = f"{current_hour:02d}:{current_minute:02d}"
        times.append(time_str)
        
        # Add the interval
        current_hour += step_hours
        
        # Handle hour overflow (beyond 24 hours)
        if current_hour >= 24:
            break
    
    print(f"Generated {len(times)} scheduled times for today: {times}")
    return times

def randomize_time_str(time_str: str) -> str:
    """Take an HH:MM time string and return a randomized HH:MM:SS string within the previous 5 minutes."""
    dt = datetime.strptime(time_str, "%H:%M")
    
    # Subtract random minutes (0-4) and seconds (0-59)
    random_minutes = random.randint(0, 4)
    random_seconds = random.randint(0, 59)
    
    new_dt = dt - timedelta(minutes=random_minutes, seconds=random_seconds)
    return new_dt.strftime("%H:%M:%S")

def get_next_time_slot(times: list[str]) -> str:
    """Return the next scheduled time slot as a string."""
    now = datetime.now().strftime("%H:%M:%S")
    idx = bisect.bisect_right(times, now)
    if idx >= len(times):
        return times[0]  # Next day
    return times[idx]

def ask_claude():
    """Ask Claude a question using CLI"""
    question = random.choice(QUESTIONS)
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
            CLAUDE_COMMAND + ["--model", CLAUDE_MODEL, "-p", question],
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
    # Announce next slot
    next_slot = get_next_time_slot(scheduled_times)
    print(f"Next scheduled run will be at: {next_slot}")

def main():
    print("=" * 50)
    print("Claude CLI Question Asker - Starting up...")
    print("=" * 50)
    
    global scheduled_times

    # Test Claude CLI
    try:
        result = subprocess.run(CLAUDE_COMMAND + ["--version"], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            print(f"Error: Claude CLI returned an error: {result.stderr}")
            return
    except FileNotFoundError:
        print("Error: The 'claude' command-line tool is not installed or not in your system's PATH.")
        print("Please install the Claude CLI to proceed.")
        return
    except Exception as e:
        print(f"An unexpected error occurred while checking for Claude CLI: {e}")
        return
    
    print("✓ Claude CLI ready")
    
    scheduled_times = generate_daily_times(start_time, interval_hours)

    print("Claude CLI Question Asker started.")
    print(f"First run at {start_time}, then every {interval_hours} hours.")
    print("Today's schedule:")
    for t in scheduled_times:
        # Convert to 12-hour format
        dt = datetime.strptime(t, "%H:%M")
        t_12 = dt.strftime("%I:%M %p")
        print(f"  {t}  ({t_12})")

    print("\nScheduling tasks...")
    
    # Keep track of the randomized times for display
    randomized_schedule = []

    for i, t in enumerate(scheduled_times):
        # The first task runs at the exact start time, the rest are randomized
        if i == 0:
            random_t = datetime.strptime(t, "%H:%M").strftime("%H:%M:%S")
        else:
            random_t = randomize_time_str(t)
        
        randomized_schedule.append(random_t)

        def make_job(slot, random_slot):
            def job():
                print(f"\n[Status] Scheduled run for target {slot} (at {random_slot}) starting now.")
                ask_claude()
            return job
        
        schedule.every().day.at(random_t).do(make_job(t, random_t))
        
        # Print both 24-hour and 12-hour format
        dt = datetime.strptime(random_t, "%H:%M:%S")
        t_12 = dt.strftime("%I:%M %p")
        print(f"  Target: {t}, Scheduled: {random_t} ({t_12})")

    # Update the global scheduled_times to be the randomized ones for correct 'next_slot' display
    scheduled_times = sorted(randomized_schedule)

    # Announce the next run *after* the schedule has been randomized
    next_slot = get_next_time_slot(scheduled_times)
    # Show next slot in 12-hour format
    dt_next = datetime.strptime(next_slot, "%H:%M:%S")
    next_slot_12 = dt_next.strftime("%I:%M %p")
    print(f"\nNext scheduled run is at: {next_slot}  ({next_slot_12})")

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Entering main loop - checking every second...")
    print("Press Ctrl+C to stop the program\n")

    while True:
        schedule.run_pending()
        # Print next slot every loop
        next_slot = get_next_time_slot(scheduled_times)
        dt_next = datetime.strptime(next_slot, "%H:%M:%S")
        next_slot_12 = dt_next.strftime("%I:%M %p")
        print(f"[Status] Next scheduled run is at: {next_slot}  ({next_slot_12})", end='\r')
        time.sleep(1)

if __name__ == "__main__":
    main()

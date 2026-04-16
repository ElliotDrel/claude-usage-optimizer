#!/usr/bin/env python3
"""
Claude Message Sender (revised)
Opens Claude.ai, sends a greeting, then deletes the chat.
Runs every day at a set start time and fixed hourly interval.
"""

import webbrowser
import time
import pyautogui
from datetime import datetime, timedelta
import schedule
import bisect

# User‑configurable settings
chat_message = "hi what time is it right now?"
chat_name_x, chat_name_y = 150, 150
delete_button_x, delete_button_y = 150, 250

start_time = "05:05"      # 24‑hour format
interval_hours = 5        # hours between runs

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

def get_next_time_slot(times: list[str]) -> str:
    """Return the next scheduled time slot as a string."""
    now = datetime.now().strftime("%H:%M")
    idx = bisect.bisect_right(times, now)
    if idx >= len(times):
        return times[0]  # Next day
    return times[idx]

def send_claude_message():
    """Automate browser and UI actions."""
    current_time = datetime.now().strftime("%H:%M:%S")
    print(f"\n[{current_time}] Starting Claude message automation...")
    print(f"Status: Opening Claude.ai in browser...")
    
    webbrowser.open_new_tab("https://claude.ai")

    print("Waiting 5 seconds before typing …")
    time.sleep(5)
    print(f"Status: Typing message: '{chat_message}'")
    pyautogui.write(chat_message)

    print("Status: Sending message …")
    pyautogui.press("enter")

    # optional backup send
    print("Waiting 1 second before backup send...")
    time.sleep(1)
    print("Status: Sending backup message...")
    pyautogui.write(chat_message)
    pyautogui.press("enter")

    # delete chat
    print("Waiting 1 second before deleting chat...")
    time.sleep(1)
    print(f"Status: Clicking chat name at coordinates ({chat_name_x}, {chat_name_y})...")
    pyautogui.click(x=chat_name_x, y=chat_name_y)
    time.sleep(1)
    print(f"Status: Clicking delete button at coordinates ({delete_button_x}, {delete_button_y})...")
    pyautogui.click(x=delete_button_x, y=delete_button_y)
    time.sleep(1)
    print("Status: Confirming deletion...")
    pyautogui.press("enter")
    pyautogui.press("enter")
    print("Status: Finished run.")
    # --- End of chat deletion block ---
    # Announce next slot
    next_slot = get_next_time_slot(scheduled_times)
    print(f"Next scheduled run will be at: {next_slot}")

def main():
    print("=" * 50)
    print("Claude Message Sender - Starting up...")
    print("=" * 50)
    global scheduled_times
    scheduled_times = generate_daily_times(start_time, interval_hours)

    print("Claude Message Sender started.")
    print(f"First run at {start_time}, then every {interval_hours} hours.")
    print("Today's schedule:")
    for t in scheduled_times:
        # Convert to 12-hour format
        dt = datetime.strptime(t, "%H:%M")
        t_12 = dt.strftime("%I:%M %p")
        print(f"  {t}  ({t_12})")
    next_slot = get_next_time_slot(scheduled_times)
    # Show next slot in 12-hour format
    dt_next = datetime.strptime(next_slot, "%H:%M")
    next_slot_12 = dt_next.strftime("%I:%M %p")
    print(f"\nNext scheduled run is at: {next_slot}  ({next_slot_12})")

    print("\nScheduling tasks...")
    for t in scheduled_times:
        def make_job(slot):
            def job():
                print(f"\n[Status] Scheduled run for {slot} starting now.")
                send_claude_message()
            return job
        schedule.every().day.at(t).do(make_job(t))
        # Print both 24-hour and 12-hour format
        dt = datetime.strptime(t, "%H:%M")
        t_12 = dt.strftime("%I:%M %p")
        print(f"  Scheduled task for {t}  ({t_12})")

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Entering main loop - checking every 30 seconds...")
    print("Press Ctrl+C to stop the program\n")

    while True:
        schedule.run_pending()
        # Print next slot every loop
        next_slot = get_next_time_slot(scheduled_times)
        dt_next = datetime.strptime(next_slot, "%H:%M")
        next_slot_12 = dt_next.strftime("%I:%M %p")
        print(f"[Status] Next scheduled run is at: {next_slot}  ({next_slot_12})", end='\r')
        time.sleep(30)

if __name__ == "__main__":
    main()

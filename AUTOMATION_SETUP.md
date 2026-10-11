# 🤖 Utkal.ai — Automatic Odia Data Agents Automation Guide

This guide documents the Windows-native automatic scheduling and supervision architecture for **Utkal.ai Zero-Cost Odia Data Collection Agents**.

---

## 1. Architecture Overview

### The 18-Hour Work & Idle Cycle
The pipeline executes on a cyclic schedule:
- **Session Duration:** Up to **9 hours** of active data collection.
- **Pass Interval:** Repeats preview pipeline passes every **15 minutes** (configurable).
- **Cycle Duration:** Exactly **18 hours** from session start to the next session start.
- **Idle Gap:** Approximately **9 hours** of idle time after the 9-hour work window completes before the next session begins.
- **Repetition:** Runs automatically and continuously without human intervention.

#### Example Timeline:
| Cycle | Session Starts | Session Ends (9h work) | Next Session Starts (18h from start) | Idle Time |
|---|---|---|---|---|
| **Cycle 1** | **06:00 AM** | 03:00 PM | **12:00 AM (Midnight)** | 9 Hours |
| **Cycle 2** | **12:00 AM** | 09:00 AM | **06:00 PM** | 9 Hours |
| **Cycle 3** | **06:00 PM** | 03:00 AM | **12:00 PM (Noon)** | 9 Hours |

---

## 2. File Components

| File | Purpose |
|---|---|
| [`run_odia_agents.ps1`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/run_odia_agents.ps1) | Core PowerShell supervisor managing the 9-hour work session, pass loops, single-instance lock, timeout enforcement, and log output. |
| [`run_odia_agents.bat`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/run_odia_agents.bat) | Batch launcher invoking PowerShell with `ExecutionPolicy Bypass`, compatible with Task Scheduler and CMD. |
| [`setup_odia_agents_task.ps1`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/setup_odia_agents_task.ps1) | Helper utility to Register, Inspect, Start, Stop, or Remove the Windows Task Scheduler task `Utkal Odia Data Agents`. |
| [`logs/odia_agents.log`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/logs/odia_agents.log) | Primary rotating supervisor log capturing session IDs, pass results, URLs, documents, chunks, and errors. |
| [`logs/odia_agents.lock`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/logs/odia_agents.lock) | Concurrency lock protecting against duplicate or overlapping supervisor processes. |
| [`data/odia_agent_output/`](file:///c:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/data/odia_agent_output/) | Isolated directory containing `discovered_urls.jsonl`, `documents.jsonl`, `chunks.jsonl`, `failed_or_skipped.jsonl`, and `report.json`. |

---

## 3. Quick-Start Commands (PowerShell)

Open Windows PowerShell in the project directory:
```powershell
cd C:\Users\kumar\.gemini\antigravity\scratch\odia-ai-backend
```

### A. Test a Single Pipeline Pass (Manual Verification)
Verify that the underlying agent pipeline executes cleanly:
```powershell
python -m agents.odia_data_agents.cli --preview --max-urls 2
```

### B. Test the Supervisor in Fast Test Mode (30-second Session)
Runs the supervisor with short test parameters to verify process management, locking, and logging without waiting 9 hours:
```powershell
powershell -ExecutionPolicy Bypass -File .\run_odia_agents.ps1 -SessionHours 0.01 -IntervalMinutes 0.1 -BufferMinutes 0.05
```

### C. Register the 18-Hour Scheduled Task in Windows Task Scheduler
Registers `Utkal Odia Data Agents` with a daily starting point of `06:00` and an exact 18-hour interval:
```powershell
powershell -ExecutionPolicy Bypass -File .\setup_odia_agents_task.ps1 -Action Register -StartTime "06:00"
```

### D. Check Task Scheduler Status & Next Run Time
```powershell
powershell -ExecutionPolicy Bypass -File .\setup_odia_agents_task.ps1 -Action Status
```

### E. Manually Trigger a Run
```powershell
powershell -ExecutionPolicy Bypass -File .\setup_odia_agents_task.ps1 -Action Start
```

### F. Stop a Running Task
```powershell
powershell -ExecutionPolicy Bypass -File .\setup_odia_agents_task.ps1 -Action Stop
```

### G. Unregister / Remove the Scheduled Task
```powershell
powershell -ExecutionPolicy Bypass -File .\setup_odia_agents_task.ps1 -Action Remove
```

---

## 4. Continuous Daemon Mode (Alternative to Task Scheduler)

If you prefer to run the supervisor directly in a persistent PowerShell window or background terminal without Windows Task Scheduler:
```powershell
powershell -ExecutionPolicy Bypass -File .\run_odia_agents.ps1 -Continuous -SessionHours 9.0 -IntervalMinutes 15.0 -CycleHours 18.0
```
In `-Continuous` mode:
1. The supervisor executes passes every 15 minutes for 9 hours.
2. At the 9-hour mark, it finishes cleanly and enters an idle sleep phase for 9 hours.
3. At the 18-hour mark from the initial start, it automatically wakes up and begins the next 9-hour session.

---

## 5. Log Files & Monitoring

### Primary Supervisor Log:
```text
C:\Users\kumar\.gemini\antigravity\scratch\odia-ai-backend\logs\odia_agents.log
```

Each pass records:
- **Session ID** (e.g., `sess_20261011_060000`)
- **Pass Number**
- **Duration** and **Exit Code**
- **Discovered URLs** count
- **Accepted Documents** count
- **Generated Chunks** count
- **Rejected Records** count
- **Next Scheduled Start Timestamp**

#### Real-time Monitoring Command:
```powershell
Get-Content -Path .\logs\odia_agents.log -Tail 30 -Wait
```

### Automatic Log Rotation:
When `odia_agents.log` reaches **10 MB**, it automatically rotates up to 5 historical archive files (`odia_agents.log.1`, `odia_agents.log.2`, etc.) to prevent unbounded disk growth.

---

## 6. Safety, Security & Zero-Cost Guarantees

1. **Zero Vector-Store Mutation:**
   The supervisor calls the Python CLI in `--preview` mode. It **never passes `--index`**, guaranteeing that existing vector stores (`data/vector_store_fallback.json` or PostgreSQL `rag_chunks`) are never modified or reset.
2. **Zero Paid API Calls:**
   Uses local rule-based parsing, local character n-gram extraction, and public web scraping. No Gemini API tokens, OpenAI keys, or external paid services are consumed.
3. **Single-Instance Protection:**
   Uses a PID lock file (`logs/odia_agents.lock`). If an instance is already executing, any secondary trigger exits immediately to avoid CPU/memory contention or duplicate web requests.
4. **Child Process Tree Termination:**
   If a single pass exceeds its timeout threshold (default 30 min) or the 9-hour work window expires, `taskkill.exe /PID <pid> /T /F` terminates the child Python process tree cleanly, eliminating orphaned processes.

---

## 7. Windows Sleep, Restart & Interruption Policies

- **Computer Sleep / Hibernation:**
  If the computer sleeps during a work window or idle window, the Windows clock advances. When the computer wakes up:
  - If registered in Task Scheduler with Missed Run recovery, Task Scheduler launches the session.
  - If a pass was interrupted by sleep, the supervisor detects the deadline and exits cleanly.
- **Computer Restart / Reboot:**
  - Upon reboot, `setup_odia_agents_task.ps1`'s registered Task Scheduler task will execute at the next configured 18-hour interval.
  - Any stale lock file left by an abrupt system shutdown is automatically detected and cleared upon the next run.
- **Logon Type & Permissions:**
  The task is configured for the current interactive Windows user (`-LogonType Interactive`), requiring no hardcoded passwords.

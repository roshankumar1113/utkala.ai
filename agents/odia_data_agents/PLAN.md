# Utkal.ai Odia Data Collection Multi-Agent System - Architecture Plan

## 1. Objective
Build an isolated, zero-cost, local-running multi-agent data collection and preparation pipeline for Utkal.ai on Windows without breaking, modifying, or degrading any existing Utkal.ai functionality, routes, databases, or existing files.

## 2. Directory Layout
New isolated module in root:
`agents/`
  `odia_data_agents/`
    `__init__.py`
    `config.py`               # Default seeds, limits, categories, validation thresholds
    `security.py`             # SSRF prevention, IP validation, URL sanitization
    `discovery_agent.py`      # Agent 1: Seed crawling, link extraction, robots.txt, categorization
    `extraction_agent.py`     # Agent 2: Odia Unicode cleaner, HTML/PDF extraction, hash deduplication
    `chunking_agent.py`       # Agent 3: Odia-aware sentence (।) & paragraph chunker, deterministic IDs
    `validation_agent.py`     # Agent 4: Quality validator, dimension checker, safe indexer
    `pipeline.py`             # Multi-agent orchestrator
    `cli.py`                  # Command line interface with PowerShell-friendly commands

Output directory (created automatically):
`data/odia_agent_output/`
  `discovered_urls.jsonl`
  `documents.jsonl`
  `chunks.jsonl`
  `failed_or_skipped.jsonl`
  `report.json`
  `agent_run.log`

Automated test suite:
`tests/test_odia_data_agents.py`

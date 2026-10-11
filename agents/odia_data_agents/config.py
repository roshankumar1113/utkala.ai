"""
config.py — Configuration models and default seed settings for Utkal.ai Odia Data Agents.
"""

import os
from pathlib import Path
from typing import Dict, List, Any
from dataclasses import dataclass, field


DEFAULT_SEEDS: Dict[str, List[str]] = {
    "government": [
        "https://subhadra.odisha.gov.in",
        "https://kalia.odisha.gov.in",
        "https://odisha.gov.in",
        "https://msme.odisha.gov.in",
    ],
    "literature": [
        "https://or.wikisource.org/wiki/%E0%AC%AA%E0%AD%8D%E0%AC%B0%E0%AC%A7%E0%AC%BE%E0%AC%A8_%E0%AC%AA%E0%AC%A4%E0%AC%BE",
    ],
    "education": [
        "https://or.wikipedia.org/wiki/%E0%AC%93%E0%AC%A1%E0%AC%BC%E0%AC%BF%E0%AC%86_%E0%AC%AD%E0%AC%BE%E0%AC%B7%E0%AC%BE",
        "https://or.wikipedia.org/wiki/%E0%AC%93%E0%AC%A1%E0%AC%BC%E0%AC%BF%E0%AC%B6%E0%AC%BE",
    ],
    "general_knowledge": [
        "https://or.wikipedia.org/wiki/%E0%AC%9C%E0%AC%97%E0%AC%A8%E0%AC%8D%E0%AC%A8%E0%AC%BE%E0%AC%A5_%E0%AC%AE%E0%AC%A8%E0%AD%8D%E0%AC%A6%E0%AC%BF%E0%AC%B0",
    ],
    "news": [
        "https://or.wikipedia.org/wiki/Portal:%E0%AC%86%E0%AC%9C%E0%AC%BF%E0%AC%B0_%E0%AC%B8%E0%AC%BE%E0%AC%A7%E0%AC%BE%E0%AC%B0%E0%AC%A3_%E0%AC%9C%E0%AC%BE%E0%AC%A3%E0%AC%BF%E0%AC%AC%E0%AC%BE_%E0%AC%95%E0%AC%A5%E0%AC%BE",
    ]
}


@dataclass
class AgentConfig:
    # Directory paths
    project_root: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent.parent
    )
    output_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data" / "odia_agent_output"
    )

    # Crawling & Discovery limits
    seeds: Dict[str, List[str]] = field(default_factory=lambda: dict(DEFAULT_SEEDS))
    max_depth: int = 1
    max_urls_per_domain: int = 5
    request_timeout: float = 10.0
    request_delay: float = 0.5
    max_response_bytes: int = 5 * 1024 * 1024  # 5 MB max per document
    user_agent: str = (
        "UtkalAI-OdiaDataBot/1.0 (+https://github.com/roshankumar1113/utkala.ai; public research)"
    )

    # Extraction & Cleaning parameters
    min_doc_chars: int = 60
    min_odia_ratio: float = 0.15  # Minimum 15% Odia Unicode for mixed/Odia docs
    require_odia_script: bool = True
    dedup_by_hash: bool = True

    # Chunking parameters
    chunk_size: int = 500
    chunk_overlap: int = 100
    min_chunk_length: int = 50

    # Indexing & Safety settings
    dry_run: bool = True
    embedding_backend: str = "ngram"  # "ngram" (128-dim, local free) or "gemini" (768-dim)
    enforce_vector_dim_match: bool = True

    def __post_init__(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)

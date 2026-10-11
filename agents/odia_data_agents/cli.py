"""
cli.py — Command-Line Interface for Utkal.ai Odia Data Agents.
"""

import sys
import argparse
from pathlib import Path

from .config import AgentConfig
from .pipeline import OdiaAgentPipeline


def main():
    parser = argparse.ArgumentParser(
        description="Utkal.ai Zero-Cost Odia Data Collection Agent System"
    )
    parser.add_argument(
        "--preview",
        "--dry-run",
        action="store_true",
        default=True,
        help="Run discovery, extraction, chunking, and validation without indexing (default: True)",
    )
    parser.add_argument(
        "--index",
        action="store_true",
        help="Explicitly request indexing into vector store (subject to dimension verification)",
    )
    parser.add_argument(
        "--discovery-only",
        action="store_true",
        help="Stop after Stage 1: URL discovery",
    )
    parser.add_argument(
        "--extract-only",
        action="store_true",
        help="Stop after Stage 2: Document extraction & cleaning",
    )
    parser.add_argument(
        "--chunk-only",
        action="store_true",
        help="Stop after Stage 3: Odia-aware chunking",
    )
    parser.add_argument(
        "--max-urls",
        type=int,
        default=3,
        help="Maximum URLs to discover per domain (default: 3)",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=1,
        help="Maximum link crawling depth (default: 1)",
    )
    parser.add_argument(
        "--backend",
        type=str,
        default="ngram",
        choices=["ngram", "gemini", "sentence-transformers"],
        help="Embedding backend for dimension checks: ngram (128d, free local) or gemini (768d)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Custom output directory for data artifacts",
    )

    args = parser.parse_args()

    config = AgentConfig()
    config.max_urls_per_domain = args.max_urls
    config.max_depth = args.max_depth
    config.embedding_backend = args.backend
    config.dry_run = not args.index

    if args.output_dir:
        config.output_dir = Path(args.output_dir)
        config.output_dir.mkdir(parents=True, exist_ok=True)

    pipeline = OdiaAgentPipeline(config)
    pipeline.run(
        discovery_only=args.discovery_only,
        extract_only=args.extract_only,
        chunk_only=args.chunk_only,
        force_index=args.index,
    )


if __name__ == "__main__":
    main()

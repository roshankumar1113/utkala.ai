"""
pipeline.py — Multi-Agent Orchestrator for Utkal.ai Odia Data Collection.
Coordinates Agent 1 (Discovery) → Agent 2 (Extraction) → Agent 3 (Chunking) → Agent 4 (Validation & Safe Indexing).
"""

import sys
import logging
from typing import Dict, Any, Optional

from .config import AgentConfig
from .discovery_agent import DiscoveryAgent
from .extraction_agent import ExtractionAgent
from .chunking_agent import ChunkingAgent
from .validation_indexing_agent import ValidationIndexingAgent


def setup_logger(output_dir) -> logging.Logger:
    logger = logging.getLogger("odia_agents")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    # Console Handler
    c_handler = logging.StreamHandler(sys.stdout)
    c_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(c_handler)

    # File Handler
    log_file = output_dir / "agent_run.log"
    f_handler = logging.FileHandler(str(log_file), encoding="utf-8")
    f_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(f_handler)

    return logger


class OdiaAgentPipeline:
    """
    End-to-end pipeline executing the 4 agents in sequential isolated stages.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self.logger = setup_logger(self.config.output_dir)

        self.discovery_agent = DiscoveryAgent(self.config)
        self.extraction_agent = ExtractionAgent(self.config)
        self.chunking_agent = ChunkingAgent(self.config)
        self.validation_agent = ValidationIndexingAgent(self.config)

    def run(
        self,
        discovery_only: bool = False,
        extract_only: bool = False,
        chunk_only: bool = False,
        force_index: bool = False,
    ) -> Dict[str, Any]:
        """Runs the configured stages of the pipeline."""
        self.logger.info("=" * 60)
        self.logger.info("🚀 UTKAL.AI ZERO-COST ODIA DATA COLLECTION AGENTS")
        self.logger.info(f"   Output Directory: {self.config.output_dir}")
        self.logger.info(f"   Dry Run Mode: {self.config.dry_run and not force_index}")
        self.logger.info(f"   Embedding Backend: {self.config.embedding_backend}")
        self.logger.info("=" * 60)

        # ── STAGE 1: Discovery ───────────────────────────────────────────────
        discovered_urls = self.discovery_agent.discover()
        if discovery_only:
            self.logger.info("🏁 Discovery-only mode finished.")
            return {"discovered_urls": discovered_urls}

        # ── STAGE 2: Extraction & Cleaning ───────────────────────────────────
        accepted_docs = self.extraction_agent.process_records(discovered_urls)
        if extract_only:
            self.logger.info("🏁 Extraction-only mode finished.")
            return {"discovered_urls": discovered_urls, "documents": accepted_docs}

        # ── STAGE 3: Odia-Aware Chunking ─────────────────────────────────────
        chunks = self.chunking_agent.chunk_all(accepted_docs)
        if chunk_only:
            self.logger.info("🏁 Chunk-only mode finished.")
            return {
                "discovered_urls": discovered_urls,
                "documents": accepted_docs,
                "chunks": chunks,
            }

        # ── STAGE 4: Quality Validation & Safe Indexing ──────────────────────
        val_summary = self.validation_agent.validate(accepted_docs, chunks)
        index_result = self.validation_agent.safe_index(chunks, force_index=force_index)

        # Write final audit report
        report_path = self.validation_agent.write_report(
            discovery_count=len(discovered_urls),
            documents=accepted_docs,
            chunks=chunks,
            index_result=index_result,
        )

        self.logger.info("=" * 60)
        self.logger.info("🎉 PIPELINE RUN COMPLETED SUCCESSFULLY")
        self.logger.info(f"   Discovered: {len(discovered_urls)} URLs")
        self.logger.info(f"   Accepted:   {len(accepted_docs)} Documents")
        self.logger.info(f"   Chunks:     {len(chunks)} Chunks")
        self.logger.info(f"   Audit Report: {report_path}")
        self.logger.info("=" * 60)

        return {
            "discovered_urls": discovered_urls,
            "documents": accepted_docs,
            "chunks": chunks,
            "validation": val_summary,
            "indexing": index_result,
            "report_path": str(report_path),
        }

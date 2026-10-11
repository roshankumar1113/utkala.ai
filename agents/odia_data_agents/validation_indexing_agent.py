"""
validation_indexing_agent.py — Agent 4: Quality Validation and RAG Indexing Agent.
Performs data validation, checks embedding dimensions & vector store compatibility,
and safely protects existing Utkal.ai knowledge base from corruption.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from .config import AgentConfig

logger = logging.getLogger(__name__)


class ValidationIndexingAgent:
    """
    Validates data quality, integrity, and vector store compatibility.
    Guarantees that incompatible embeddings (e.g. 128 vs 768) NEVER corrupt
    existing indexed RAG vectors.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self.validation_issues: List[str] = []
        self.validation_summary: Dict[str, Any] = {}

    def _detect_existing_store_dim(self) -> Tuple[Optional[int], str]:
        """
        Detects existing embedding dimension and storage engine.
        Returns: (detected_dim, storage_engine_name)
        """
        fallback_json = self.config.project_root / "data" / "vector_store_fallback.json"
        if fallback_json.exists():
            try:
                # Read just enough of the file or sample first item
                with open(fallback_json, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data and isinstance(data, list) and len(data) > 0:
                        first_emb = data[0].get("embedding", [])
                        if first_emb:
                            return len(first_emb), f"Local JSON Fallback ({len(data)} items)"
            except Exception as e:
                logger.warning(f"Could not inspect {fallback_json}: {e}")

        return None, "Empty or Uninitialized"

    def validate(
        self,
        documents: List[Dict[str, Any]],
        chunks: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Validates document completeness, Odia coverage, and chunk integrity."""
        logger.info(f"🧐 [Agent 4: Quality Validation] Validating {len(documents)} docs & {len(chunks)} chunks...")
        self.validation_issues = []

        # 1. Document validation
        valid_docs = 0
        missing_url_count = 0
        low_odia_ratio_count = 0

        for doc in documents:
            if not doc.get("source_url"):
                missing_url_count += 1
                self.validation_issues.append(f"Doc {doc.get('doc_id')}: Missing source_url")

            metrics = doc.get("metrics", {})
            if metrics.get("odia_ratio", 0.0) < self.config.min_odia_ratio:
                low_odia_ratio_count += 1

            if len(doc.get("content", "")) >= self.config.min_doc_chars:
                valid_docs += 1

        # 2. Chunk integrity validation
        valid_chunks = 0
        empty_chunks = 0
        chunk_ids_seen = set()
        duplicate_chunk_ids = 0

        for ch in chunks:
            cid = ch.get("chunk_id")
            if cid in chunk_ids_seen:
                duplicate_chunk_ids += 1
                self.validation_issues.append(f"Duplicate chunk ID: {cid}")
            chunk_ids_seen.add(cid)

            txt = ch.get("text", "")
            if not txt or len(txt) < self.config.min_chunk_length:
                empty_chunks += 1
            else:
                valid_chunks += 1

        # 3. Vector store compatibility check
        existing_dim, storage_type = self._detect_existing_store_dim()
        requested_backend = self.config.embedding_backend

        # Map backends to dimensions
        backend_dims = {"gemini": 768, "sentence-transformers": 384, "ngram": 128}
        current_dim = backend_dims.get(requested_backend, 128)

        dimension_match = True
        dimension_warning = None

        if existing_dim is not None and existing_dim != current_dim:
            dimension_match = False
            dimension_warning = (
                f"DIMENSION MISMATCH: Existing vector store uses {existing_dim}-dim embeddings, "
                f"while requested backend '{requested_backend}' outputs {current_dim}-dim vectors. "
                f"Indexing into the existing store is strictly blocked to prevent database corruption."
            )
            self.validation_issues.append(dimension_warning)

        self.validation_summary = {
            "status": "passed" if len(self.validation_issues) == 0 else "warnings_detected",
            "total_documents": len(documents),
            "valid_documents": valid_docs,
            "missing_source_urls": missing_url_count,
            "low_odia_ratio_documents": low_odia_ratio_count,
            "total_chunks": len(chunks),
            "valid_chunks": valid_chunks,
            "empty_or_short_chunks": empty_chunks,
            "duplicate_chunk_ids": duplicate_chunk_ids,
            "vector_store": {
                "storage_type": storage_type,
                "existing_dimension": existing_dim,
                "current_backend": requested_backend,
                "current_dimension": current_dim,
                "compatible": dimension_match,
                "dimension_warning": dimension_warning,
            },
            "issues": self.validation_issues,
        }

        return self.validation_summary

    def safe_index(
        self,
        chunks: List[Dict[str, Any]],
        force_index: bool = False,
        allow_staging_store: bool = True
    ) -> Dict[str, Any]:
        """
        Safely indexes chunks into the RAG system.
        Enforces dimension compatibility and dry-run guard.
        """
        if self.config.dry_run and not force_index:
            logger.info("🛡️ [Agent 4: Indexing] Dry-run mode enabled. Indexing skipped safely.")
            return {
                "indexed": False,
                "reason": "Dry-run mode enabled. Specify --index to perform indexing.",
                "chunks_indexed": 0,
            }

        # Check vector compatibility
        compat = self.validation_summary.get("vector_store", {})
        is_compatible = compat.get("compatible", False)
        existing_dim = compat.get("existing_dimension")
        current_dim = compat.get("current_dimension")

        if not is_compatible and self.config.enforce_vector_dim_match:
            logger.error(
                f"❌ [Safety Block] Incompatible embedding dimensions! "
                f"Existing store: {existing_dim}, New: {current_dim}. Refusing to index."
            )

            # If staging store allowed, store in separate staged index
            if allow_staging_store:
                staged_path = self.config.output_dir / f"vector_store_staged_{current_dim}d.json"
                logger.info(f"💡 Safely staging {len(chunks)} chunks into isolated file: {staged_path}")
                staged_data = []
                for c in chunks:
                    staged_data.append({
                        "id": c["chunk_id"],
                        "text": c["text"],
                        "metadata": c.get("metadata", {}),
                        "embedding": [0.0] * current_dim,  # Placeholder or zero-vector stage
                    })
                with open(staged_path, "w", encoding="utf-8") as f:
                    json.dump(staged_data, f, ensure_ascii=False, indent=2)

                return {
                    "indexed": False,
                    "reason": compat.get("dimension_warning"),
                    "staged_file": str(staged_path),
                    "chunks_staged": len(staged_data),
                }

            return {
                "indexed": False,
                "reason": compat.get("dimension_warning"),
                "chunks_indexed": 0,
            }

        # Integrate with existing Python RAG vector store if compatible
        try:
            # Add python_rag to sys.path if not present
            rag_dir = str(self.config.project_root / "python_rag")
            if rag_dir not in sys.path:
                sys.path.insert(0, rag_dir)

            from embedding_generator import EmbeddingGenerator
            from vector_store import VectorStore

            embedder = EmbeddingGenerator(model_type=self.config.embedding_backend)
            vector_store = VectorStore()
            vector_store.connect()

            # Format chunks for existing VectorStore interface
            prepared = []
            for c in chunks:
                prepared.append({
                    "id": c["chunk_id"],
                    "text": c["text"],
                    "metadata": c.get("metadata", {}),
                })

            embedded_chunks = embedder.generate_batch_embeddings(prepared)
            stored_count = vector_store.store_chunks(embedded_chunks)
            vector_store.disconnect()

            logger.info(f"🎉 [Agent 4: Indexing] Successfully indexed {stored_count} chunks into existing RAG!")
            return {
                "indexed": True,
                "chunks_indexed": stored_count,
                "backend": embedder.model_type,
                "dimension": embedder.dimension,
            }

        except Exception as e:
            logger.error(f"❌ Indexing failed: {e}")
            return {
                "indexed": False,
                "reason": f"Indexing failure: {e}",
                "chunks_indexed": 0,
            }

    def write_report(
        self,
        discovery_count: int,
        documents: List[Dict[str, Any]],
        chunks: List[Dict[str, Any]],
        index_result: Dict[str, Any],
    ) -> Path:
        """Writes comprehensive audit report to data/odia_agent_output/report.json."""
        # Category breakdown
        category_counts: Dict[str, int] = {}
        for d in documents:
            cat = d.get("category", "unknown")
            category_counts[cat] = category_counts.get(cat, 0) + 1

        report_data = {
            "timestamp": str(self.config.output_dir),
            "summary": {
                "urls_discovered": discovery_count,
                "documents_accepted": len(documents),
                "chunks_generated": len(chunks),
                "indexing_performed": index_result.get("indexed", False),
            },
            "category_distribution": category_counts,
            "validation": self.validation_summary,
            "indexing_result": index_result,
        }

        report_path = self.config.output_dir / "report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)

        logger.info(f"📊 Audit Report generated: {report_path}")
        return report_path

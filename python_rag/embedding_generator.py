from typing import Dict, Any, List
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None


class EmbeddingGenerator:
    """
    EmbeddingGenerator Class in Python for RAG Systems.
    Uses SentenceTransformers with model "all-MiniLM-L6-v2" to generate 384-dim vector embeddings.
    """
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", max_char_length: int = 512):
        self.model_name = model_name
        self.max_char_length = max_char_length
        self.model = None

    def load_model(self):
        if self.model is None:
            if SentenceTransformer is None:
                raise RuntimeError(
                    "sentence_transformers library is not installed. "
                    "Run `pip install sentence-transformers`."
                )
            print(f'🤖 [Python EmbeddingGenerator] Loading model "{self.model_name}"...')
            self.model = SentenceTransformer(self.model_name)
            print(f'✅ [Python EmbeddingGenerator] Model "{self.model_name}" loaded successfully!')

    def generate_embedding(self, text: str) -> List[float]:
        self.load_model()
        if not text or not isinstance(text, str):
            raise ValueError("Input text must be a non-empty string.")

        truncated_text = text[:self.max_char_length]
        vector = self.model.encode(truncated_text, normalize_embeddings=True)
        return vector.tolist()

    def generate_batch_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not chunks:
            return []

        self.load_model()
        print(f'🚀 [Python EmbeddingGenerator] Generating embeddings for {len(chunks)} chunks...')

        texts = [chunk["text"][:self.max_char_length] for chunk in chunks]
        vectors = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=True)

        embedded_chunks = []
        for i, chunk in enumerate(chunks):
            chunk_copy = dict(chunk)
            chunk_copy["embedding"] = vectors[i].tolist()
            embedded_chunks.append(chunk_copy)

        print(f'🎉 [Python EmbeddingGenerator] Successfully embedded {len(embedded_chunks)} chunks.')
        return embedded_chunks

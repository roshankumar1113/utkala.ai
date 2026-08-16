import os
import sys

# Ensure current directory is on sys.path
sys.path.insert(0, os.path.dirname(__file__))

from rag_pipeline import RAGPipeline

def test_python_rag():
    print("--- 🧪 TESTING FULL PYTHON RAG PIPELINE ---")
    pipeline = RAGPipeline()

    train_result = pipeline.run({
        "pdfDirectory": os.path.join(os.path.dirname(__file__), "..", "pdfs"),
        "websiteUrls": ["https://en.wikipedia.org/wiki/Odisha"]
    })

    print("\n--- 📊 PYTHON TRAIN RESULT ---")
    print(train_result)

    print("\n--- 🔍 TESTING VECTOR SEARCH IN PYTHON ---")
    search_result = pipeline.query("ସୁଭଦ୍ରା ଯୋଜନା", top_k=3)
    print("Search Result:", search_result)

if __name__ == "__main__":
    test_python_rag()

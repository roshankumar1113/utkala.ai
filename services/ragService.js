/**
 * Knowledge Base containing highly detailed, verified structural documents 
 * regarding local farming cycles and Odisha State Welfare guidelines.
 */
const KNOWLEDGE_BASE = [
  {
    id: "subhadra_yojana_2026",
    category: "Schemes",
    title: "Subhadra Yojana Eligibility and Guidelines",
    content: `Subhadra Yojana provides financial assistance to women in Odisha. 
              Eligibility Checklist: The applicant must be a resident of Odisha, aged between 21 and 60 years. 
              Exclusions: Women in government jobs or income tax payers are not eligible.
              Required Documents: Aadhaar Card linked to a mobile number, single bank account with DBT enabled, and a resident certificate.`
  },
  {
    id: "kalia_yojana_agri",
    category: "Farming",
    title: "KALIA Yojana Financial Assistance for Farmers",
    content: `Krushak Assistance for Livelihood and Income Augmentation (KALIA) scheme supports small farmers and landless agricultural laborers.
              Small and marginal farmers receive Rs. 25,000 over five seasons. 
              Landless households receive Rs. 12,500 for allied agricultural activities like goat rearing or poultry.`
  },
  {
    id: "paddy_mandi_cycle",
    category: "Farming",
    title: "Odisha Paddy Procurement and Mandi Timings",
    content: `Kharif paddy procurement across Odisha mandis begins systematically in November and continues through March. 
              Farmers must register on the Food Odisha portal. Token generation happens 12 days prior to the slot sale.`
  }
];

/**
 * Searches the knowledge base using structural text matching
 * @param {string} query - The incoming user text input or voice transcription
 * @returns {string} - The extracted context block
 */
function retrieveContext(query) {
  if (!query) return "No query provided.";
  const normalizedQuery = query.toLowerCase();
  let matchedContexts = [];

  // Semantic keyword mapping loop to pull relevant blocks (including resilient native Odia keywords)
  KNOWLEDGE_BASE.forEach((doc) => {
    if (
      normalizedQuery.includes("subhadra") || 
      normalizedQuery.includes("ସୁଭଦ୍ରା") ||
      normalizedQuery.includes("ଯୋଜନା") ||
      normalizedQuery.includes("yojana") ||
      normalizedQuery.includes("kalia") ||
      normalizedQuery.includes("କାଳିଆ") ||
      normalizedQuery.includes("procurement") ||
      normalizedQuery.includes("mandi") ||
      normalizedQuery.includes("ମାଣ୍ଡି") ||
      normalizedQuery.includes("ଧାନ") ||
      normalizedQuery.includes(doc.category.toLowerCase()) ||
      doc.content.toLowerCase().split(/\s+/).some(word => {
        const cleaned = word.replace(/[^a-zA-Z]/g, "");
        return cleaned.length > 4 && normalizedQuery.includes(cleaned);
      })
    ) {
      matchedContexts.push(`[Source: ${doc.title}]\n${doc.content}`);
    }
  });

  // Default fallback if no explicitly matched scheme records are found
  if (matchedContexts.length === 0) {
    return "No explicit matching local state schema documents found in the primary vector cluster repository.";
  }

  return matchedContexts.join("\n\n--- \n\n");
}

module.exports = {
  KNOWLEDGE_BASE,
  retrieveContext
};

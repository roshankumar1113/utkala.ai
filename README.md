# Odia.ai - Chatbot AI Engine for MSMEs in Odisha

**Odia.ai** is a premium, pure-software text chatbot MVP designed specifically for local shopkeepers, retail owners, and Micro, Small, and Medium Enterprises (MSMEs) in Odisha. 

By dropping complex voice processing modules and external audio latency barriers, the application pivots to a **clean, lightweight ChatGPT-style conversation dashboard**. 

The best part? **Your users can type their queries in standard English, pure Odia script, or Odia written in English script (Transliterated Odia, e.g., "Tame kenta achho?"), and the AI immediately comprehends the context and replies strictly in native, beautiful Odia characters (ଓଡ଼ିଆ ଅକ୍ଷର).**

---

## 🏗️ Project Architecture & Structure

The refactored project is highly simplified, eliminating complex third-party adapters and disk-caching file dependencies:

```text
odia-ai-backend/
├── .env                  # Project environment credentials (API Key)
├── .env.example          # Template for required environment variables
├── package.json          # Dependency definition & starting scripts
├── server.js             # Express app exposing the /api/chat Gemini endpoint & static hosting
├── README.md             # In-depth setup, API contracts & prompt training guide
└── public/
    └── index.html        # Premium Glassmorphic ChatGPT-style Chat App UI
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- A [Gemini AI Developer Key](https://aistudio.google.com/)

### Setup and Running

1. **Install Dependencies:**
   Ensure you are in the project folder and run:
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Rename `.env.example` to `.env` (or verify your existing `.env` file) and ensure it looks clean and simple, with **no Sarvam API keys required anymore**:
   ```env
   PORT=5000
   GEMINI_API_KEY=your_actual_gemini_api_key
   ```

3. **Start the Chat Server:**
   Launch the Node process in development or production mode:
   ```bash
   npm start
   ```

   You will see the new server startup banner:
   ```text
   =============================================
   💬 Odia.ai Chat Server running on Port 5000
   👉 Open http://localhost:5000 in your browser
   =============================================
   ```

4. **Launch the Dashboard:**
   Open your browser and navigate to **`http://localhost:5000`**. You will be greeted by the ultra-clean, glowing Sambalpuri-inspired chat dashboard!

---

## 💬 Try-Driving Chat Mode (Test Cases)

You can type in various styles. Try testing the AI with these real-world merchant query examples:

1. **Transliterated Odia (English Script):**
   *   *Input:* `"Tame kenta achho? Sabu bhala ta? Bhubaneswar re grocery shop kemiti badhaibi?"`
   *   *Expected response:* Intuitively understands the transliterated Odia greetings and questions, and responds with warm encouragement and strategic grocery marketing ideas written **strictly in Odia script**.
2. **Regular English Query:**
   *   *Input:* `"Can you give me a business strategy to grow a store in Rourkela?"*
   *   *Expected response:* Instantly translates and structures retail growth ideas, providing a comprehensive localized strategy composed **strictly in Odia script**.
3. **Pure Odia Script:**
   *   *Input:* `"ମୋ ଦୋକାନର ବିକ୍ରି ବଢ଼ାଇବା ପାଇଁ ୩ଟି ମାର୍କେଟିଂ ଟିପ୍ସ ଦିଅନ୍ତୁ।"`
   *   *Expected response:* Formulates a structured marketing list written **strictly in elegant Odia script**.

---

## 🎓 Prompt Customization (How to "Train" Your Advisor)

You can customize the tone, business strategies, and vocabulary of your chatbot by adjusting its **System Instructions**. 

### Where is it Configured?
Open **[server.js](file:///C:/Users/kumar/.gemini/antigravity/scratch/odia-ai-backend/server.js)** and modify the string constant `SYSTEM_INSTRUCTION` at the top of the file.

### Custom Instruction Directives
You can expand the system prompt to add specific MSME constraints. E.g.:
*   **Sector Optimization:** *"If the shopkeeper mentions textiles/clothing, prioritize advice relating to handloom, Sambalpuri weaves, and local festival sales (Durga Puja, Raja Parba, etc.)."*
*   **Currency Constraints:** *"Ensure all credit or ledger mentions refer to Indian Rupees (₹) and encourage digital transactions via UPI."*

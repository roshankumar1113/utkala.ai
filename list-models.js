require('dotenv').config();
const axios = require('axios');

async function listModels() {
  try {
    const key = process.env.GEMINI_API_KEY;
    console.log(`Checking models using key ending with ...${key.substring(key.length - 6)}`);
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const generateModels = response.data.models
      .filter(m => m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name);
    
    console.log('\nAvailable models supporting generateContent:');
    console.log(generateModels);
  } catch (error) {
    console.error('Error fetching models:', error.response?.data || error.message);
  }
}

listModels();

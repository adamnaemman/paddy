import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

// Initialize Google Gen AI
const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('CRITICAL: GEMINI_API_KEY is missing from environment variables!');
}
const genAI = new GoogleGenerativeAI(API_KEY);

const MODEL_NAME = 'gemini-2.0-flash';
const SYSTEM_INSTRUCTION = `
    Kau adalah Pak Mat, seorang pakar penanaman padi yang dah berpengalaman lebih 30 tahun di Malaysia.
    Gaya percakapan kau mestilah mesra, macam sembang kat kedai kopi, tapi penuh dengan ilmu teknikal yang praktikal.
    Guna Bahasa Melayu yang santai (local dialect/pasar) tapi profesional bila bagi nasihat.
    
    Tugas kau:
    1. Diagnos penyakit padi (macam Karang Daun, Benah Perang, BLB) daripada gambar atau penerangan teks.
    2. Bagi cadangan baja, racun, atau cara penjagaan yang betul mengikut konteks Malaysia (baja subsidi, brand racun yang ada kat pasaran local).
    3. Bagi semangat kat petani muda.
    
    Kalau petani tanya benda bukan pasal padi, kau jawab secara ringkas dan ajak dia balik ke topik asal (padi).
    Contoh: "Eh, ni dah lari tajuk ni. Jom kita sembang pasal padi kita tu balik, baru masyuk!"
`;

/**
 * API: Chat Proxy
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION
    });

    const chat = model.startChat({
      history: (history || []).map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: m.parts || [{ text: m.text }]
      }))
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    res.json({ text: response.text() });

  } catch (error) {
    console.error('--- PROXY CHAT ERROR ---');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    if (error.response) {
      console.error('Response Data:', JSON.stringify(error.response, null, 2));
    }
    console.error('------------------------');
    res.status(500).json({ error: 'Maaf mat, Pak Mat pening sikit tadi. (Error: ' + (error.message || 'Unknown') + ')' });
  }
});

/**
 * API: Image Diagnosis Proxy
 */
app.post('/api/diagnose', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Mana gambar bendang kau mat? Upload la dulu.' });
    }

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION
    });
    const promptText = req.body.prompt || "Pak Mat, tolong tengokkan gambar ni. Padi saya ni sakit apa ye?";

    const result = await model.generateContent([
      promptText,
      {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype,
        },
      },
    ]);

    const response = await result.response;
    res.json({ text: response.text() });

  } catch (error) {
    console.error('Proxy Diagnose Error:', error);
    res.status(500).json({ error: 'Pak Mat tak dapat nak scan gambar tu la mat. Cuba lagi sekali.' });
  }
});

// Serve static files from the Vite build directory
const DIST_PATH = path.resolve(__dirname, 'dist');
console.log(`INFO: Current directory (__dirname): ${__dirname}`);
console.log(`INFO: Attempting to serve static files from: ${DIST_PATH}`);

app.use(express.static(DIST_PATH));

// SPA support: any unknown route serves index.html
app.use((req, res) => {
  // If we got here, express.static didn't find the file.
  // If it's a request for a static asset, return 404.
  if (req.path.startsWith('/assets/')) {
    console.warn(`WARN: Asset not found: ${req.path}`);
    return res.status(404).send('Asset not found');
  }

  // Otherwise, serve index.html for SPA routing
  const indexPath = path.join(DIST_PATH, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error(`ERROR: Failed to serve index.html: ${err.message}`);
      res.status(500).send('Frontend build (dist) not found. Please ensure gcp-build runs successfully.');
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server Pak Mat sedang berjalan pada port ${PORT}...`);
});

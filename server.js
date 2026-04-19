import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

// Initialize Google Gen AI
const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });

const MODEL_NAME = 'gemini-2.5-flash';
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

// Helper to wrap the model call
const getModel = () => ai.models.getGenerativeModel({
  model: MODEL_NAME,
  config: {
    thinkingConfig: { thinkingBudget: -1 },
    systemInstruction: [{ text: SYSTEM_INSTRUCTION }]
  }
});

/**
 * API: Chat Proxy
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    
    const contents = [
      ...(history || []),
      { role: 'user', parts: [{ text: message }] }
    ];

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      config: {
        thinkingConfig: { thinkingBudget: -1 },
        systemInstruction: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: contents,
    });

    res.json({ text: result.text });
  } catch (error) {
    console.error('Proxy Chat Error:', error);
    res.status(500).json({ error: 'Maaf mat, Pak Mat pening sikit tadi. Cuba tanya balik.' });
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

    const promptText = req.body.prompt || "Pak Mat, tolong tengokkan gambar ni. Padi saya ni sakit apa ye?";
    
    const contents = [
      {
        role: 'user',
        parts: [
          { text: promptText },
          {
            inlineData: {
              data: req.file.buffer.toString('base64'),
              mimeType: req.file.mimetype,
            },
          },
        ],
      },
    ];

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      config: {
        thinkingConfig: { thinkingBudget: -1 },
        systemInstruction: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: contents,
    });

    res.json({ text: result.text });
  } catch (error) {
    console.error('Proxy Diagnose Error:', error);
    res.status(500).json({ error: 'Pak Mat tak dapat nak scan gambar tu la mat. Cuba lagi sekali.' });
  }
});

// Serve static files from the Vite build directory
app.use(express.static(path.join(__dirname, 'dist')));

// SPA support: any unknown route serves index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server Pak Mat sedang berjalan pada port ${PORT}...`);
});

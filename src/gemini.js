/**
 * Chat with Pak Mat using the backend proxy for security.
 */
export const chatWithPakMat = async (message, history = []) => {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, history }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Server error');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error("Frontend Proxy Error (Text):", error);
    return "Maaf mat, Pak Mat pening sikit tadi. Boleh tanya balik tak? (Error: Connection failed)";
  }
};

/**
 * Diagnos penyakit padi using the backend proxy for security.
 */
export const diagnoseWithImage = async (imageFile, textPrompt) => {
  try {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('prompt', textPrompt || "Pak Mat, tolong tengokkan gambar ni. Padi saya ni sakit apa ye?");

    const response = await fetch('/api/diagnose', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Server error');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error("Frontend Proxy Error (Image):", error);
    return "Pak Mat tak dapat nak scan gambar tu la mat. Cuba lagi sekali. (Error: Upload failed)";
  }
};

export default { chatWithPakMat, diagnoseWithImage };

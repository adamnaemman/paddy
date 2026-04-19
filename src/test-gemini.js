
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = "AIzaSyBiEjkSexTf-VLzpzmfehDh-GL1fHtaSVI";
const genAI = new GoogleGenerativeAI(API_KEY);

async function test() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const result = await model.generateContent("Hello");
    const response = await result.response;
    console.log("Success:", response.text());
  } catch (error) {
    console.error("Error details:", error);
    if (error.message) console.error("Message:", error.message);
    if (error.status) console.error("Status:", error.status);
  }
}

test();

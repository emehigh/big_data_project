import axios from "axios";

export class ImageProcessor {
  private ollamaUrl: string;
  private model: string;

  constructor(ollamaUrl?: string, model = "llava:latest") {
    // Use environment variable if available, otherwise fallback to parameter or default
    this.ollamaUrl = ollamaUrl || process.env.OLLAMA_URL || "http://ollama:11434";
    this.model = model;
  }

  async processImage(base64Image: string): Promise<string> {
    try {
      const response = await axios.post(
        `${this.ollamaUrl}/api/generate`,
        {
          model: this.model,
          prompt: "Describe the image in detail.",
          images: [base64Image],
          stream: false,
        },
        {
          timeout: 300000, // 300 secunde timeout
        }
      );

      return response.data.response || "No description available";
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Ollama API error: ${error.message}. Check that Ollama is running at ${this.ollamaUrl}`
        );
      }
      throw error;
    }
  }
}

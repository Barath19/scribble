import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { GoogleGenAI } from "@google/genai";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";

type Bindings = {
  R2: R2Bucket;
  GOOGLE_GEMINI_API_KEY: string;
};

interface ProcessingOptions {
  category_hints?: string[];
  extract_dates?: boolean;
  extract_contacts?: boolean;
}

interface ProcessNoteRequest {
  image: string; // base64 encoded image
  options?: ProcessingOptions;
}

interface ProcessNoteResponse {
  success: boolean;
  data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
    dates: string[];
    contacts: string[];
    confidence: number;
    raw_text: string;
  };
  processing_time_ms: number;
}

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get("/api/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// Process handwritten note image
app.post("/api/process-note", async (c) => {
  const startTime = Date.now();
  
  try {
    const apiKey = c.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ error: "Google Gemini API key not configured" }, 500);
    }

    const contentType = c.req.header("content-type");
    let imageData: string;
    let options: ProcessingOptions = {};

    if (contentType?.includes("multipart/form-data")) {
      // Handle multipart form data
      const formData = await c.req.formData();
      const imageFile = formData.get("image");
      const optionsStr = formData.get("options");

      if (!imageFile) {
        return c.json({ error: "No image file provided" }, 400);
      }

      // Type guard to ensure it's a File object
      if (typeof imageFile === 'string' || !('size' in imageFile) || !('type' in imageFile)) {
        return c.json({ error: "Invalid file format" }, 400);
      }

      const file = imageFile as File;

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        return c.json({ error: "Image file too large. Maximum size is 10MB" }, 400);
      }

      // Validate file type
      if (!file.type.startsWith("image/")) {
        return c.json({ error: "Invalid file type. Only image files are allowed" }, 400);
      }

      // Convert to base64
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binaryString);
      imageData = `data:${file.type};base64,${base64}`;

      if (optionsStr && typeof optionsStr === 'string') {
        try {
          options = JSON.parse(optionsStr);
        } catch {
          return c.json({ error: "Invalid options JSON" }, 400);
        }
      }
    } else {
      // Handle JSON payload
      const body = await c.req.json<ProcessNoteRequest>();
      
      if (!body.image) {
        return c.json({ error: "No image data provided" }, 400);
      }

      imageData = body.image;
      options = body.options || {};
    }

    // Generate unique image ID for temporary storage
    const imageId = crypto.randomUUID();
    
    // Store image temporarily in R2
    const imageBuffer = Uint8Array.from(atob(imageData.split(',')[1]), c => c.charCodeAt(0));
    await c.env.R2.put(`temp/${imageId}`, imageBuffer, {
      httpMetadata: {
        contentType: imageData.split(';')[0].split(':')[1],
        cacheControl: "max-age=3600" // 1 hour
      },
      customMetadata: {
        uploadedAt: new Date().toISOString()
      }
    });

    // Process the image using shared function
    const result = await processHandwrittenNote(imageData, options, apiKey);

    const processingTime = Date.now() - startTime;

    // Schedule cleanup of temporary image (after 1 hour)
    setTimeout(async () => {
      try {
        await c.env.R2.delete(`temp/${imageId}`);
      } catch (error) {
        console.error("Failed to cleanup temporary image:", error);
      }
    }, 3600000); // 1 hour

    return c.json({
      success: true,
      data: result,
      processing_time_ms: processingTime
    } as ProcessNoteResponse);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    if (error instanceof Error && error.message.includes("quota")) {
      return c.json({
        error: "API quota exceeded. Please try again later.",
        processing_time_ms: processingTime
      }, 429);
    }

    return c.json({
      error: "Failed to process image",
      details: error instanceof Error ? error.message : "Unknown error",
      processing_time_ms: processingTime
    }, 500);
  }
});

// Retrieve temporarily stored images
app.get("/api/images/:imageId", async (c) => {
  const imageId = c.req.param("imageId");
  
  try {
    const object = await c.env.R2.get(`temp/${imageId}`);
    
    if (!object) {
      return c.json({ error: "Image not found or expired" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    return new Response(object.body, { headers });
  } catch (error) {
    return c.json({ 
      error: "Failed to retrieve image",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

// Core processing function for reuse in both REST API and MCP
async function processHandwrittenNote(
  imageData: string,
  options: ProcessingOptions,
  apiKey: string
): Promise<any> {
  const genAI = new GoogleGenAI(apiKey);
  
  const extractDates = options.extract_dates !== false;
  const extractContacts = options.extract_contacts === true;
  const categoryHints = options.category_hints?.length 
    ? `Focus on these categories: ${options.category_hints.join(', ')}`
    : 'Infer the most appropriate category';

  const prompt = `
Analyze this handwritten note image and extract the content into structured JSON format.

Expected JSON structure:
{
  "title": "Main heading or subject of the note (if any)",
  "content": "Main body text and content",
  "category": "Inferred category (meeting, todo, idea, note, reminder, list, etc.)",
  "tags": ["relevant", "keywords", "and", "topics"],
  "dates": ${extractDates ? '["extracted dates in YYYY-MM-DD format"]' : '[]'},
  "contacts": ${extractContacts ? '["names and contact information"]' : '[]'},
  "confidence": 0.95,
  "raw_text": "All extracted text as-is"
}

Instructions:
- Extract all readable handwritten text accurately
- ${categoryHints}
- Generate 3-5 relevant tags based on content
- Set confidence score between 0.0-1.0 based on text clarity
- If no clear title exists, use the first meaningful phrase
- For dates, look for any date references, deadlines, or time mentions
- ${extractContacts ? 'Extract any names, phone numbers, or email addresses' : 'Do not extract contact information'}
- Return only valid JSON, no additional text
`;

  // Process image with Gemini
  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: imageData.split(';')[0].split(':')[1],
              data: imageData.split(',')[1]
            }
          }
        ]
      }
    ]
  });

  const responseText = response.text;
  
  if (!responseText) {
    throw new Error("Empty response from AI service");
  }
  
  // Parse JSON response
  let extractedData;
  try {
    // Clean response text to extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    extractedData = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    throw new Error(`Failed to parse AI response: ${parseError instanceof Error ? parseError.message : "Unknown parsing error"}`);
  }

  // Validate and sanitize extracted data
  const result = {
    title: extractedData.title || "Untitled Note",
    content: extractedData.content || "",
    category: extractedData.category || "note",
    tags: Array.isArray(extractedData.tags) ? extractedData.tags : [],
    dates: Array.isArray(extractedData.dates) ? extractedData.dates : [],
    contacts: Array.isArray(extractedData.contacts) ? extractedData.contacts : [],
    confidence: typeof extractedData.confidence === 'number' ? 
      Math.max(0, Math.min(1, extractedData.confidence)) : 0.8,
    raw_text: extractedData.raw_text || extractedData.content || ""
  };

  // Format todo items with checkbox prefix
  if (result.category.toLowerCase() === 'todo' || result.category.toLowerCase() === 'task') {
    // Split content into lines and add checkbox prefix to each non-empty line
    const lines = result.content.split('\n').map((line: string) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('☐') && !trimmedLine.startsWith('☑')) {
        return `☐ ${trimmedLine}`;
      }
      return line;
    });
    result.content = lines.join('\n');
  }

  return result;
}

// Create MCP server
function createMcpServer(env: Bindings) {
  const server = new McpServer({
    name: "handwritten-note-ocr-server",
    version: "1.0.0",
    description: "MCP server for converting handwritten notes to structured JSON"
  });

  // Process handwritten note tool
  server.tool(
    "process_handwritten_note",
    {
      image: z.string().describe("Base64 encoded image data (data:image/jpeg;base64,...)"),
      category_hints: z.array(z.string()).optional().describe("Optional category hints like 'meeting', 'todo', 'idea'"),
      extract_dates: z.boolean().default(true).describe("Whether to extract dates from the note"),
      extract_contacts: z.boolean().default(false).describe("Whether to extract contact information")
    },
    async ({ image, category_hints, extract_dates, extract_contacts }) => {
      try {
        const apiKey = env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Google Gemini API key not configured"
              }
            ],
            isError: true
          };
        }

        // Validate image format
        if (!image.startsWith('data:image/')) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Invalid image format. Please provide a base64 encoded image with data URL format (data:image/jpeg;base64,...)"
              }
            ],
            isError: true
          };
        }

        const options: ProcessingOptions = {
          category_hints,
          extract_dates,
          extract_contacts
        };

        const result = await processHandwrittenNote(image, options, apiKey);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error processing handwritten note: ${error instanceof Error ? error.message : "Unknown error"}`
            }
          ],
          isError: true
        };
      }
    }
  );

  return server;
}

// MCP protocol endpoint
app.all("/mcp", async (c) => {
  const mcpServer = createMcpServer(c.env);
  const transport = new StreamableHTTPTransport();
  
  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

// OpenAPI specification
app.get("/openapi.json", c => {
  return c.json(createOpenAPISpec(app, {
    info: {
      title: "Handwritten Note OCR API",
      version: "1.0.0",
      description: "Convert handwritten note images into structured JSON output using Google Gemini Vision API"
    },
  }));
});

// Fiberplane API explorer
app.use("/fp/*", createFiberplane({
  app,
  openapi: { url: "/openapi.json" }
}));

export default app;
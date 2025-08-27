# Handwritten Note OCR API with MCP Server Specification

This document outlines the design and step-by-step implementation plan for a Handwritten Note OCR API that converts handwritten note images into structured JSON output. The API also provides MCP (Model Context Protocol) server capabilities for seamless integration with AI assistants and MCP clients.

The API will support image upload, OCR processing using Google Gemini Vision, and structured data extraction from handwritten notes. The system will parse handwritten content and return organized JSON with fields like title, content, category, tags, and metadata.

The system will be built using Cloudflare Workers with Hono as the API framework, Google Gemini API for vision processing, Cloudflare R2 for image storage, and MCP server capabilities for AI assistant integration.

## 1. Technology Stack

- **Edge Runtime:** Cloudflare Workers
- **API Framework:** Hono.js (TypeScript-based API framework)
- **AI Vision Processing:** Google Gemini API (gemini-2.5-flash for fast image processing)
- **Blob Storage:** Cloudflare R2 (for temporary image storage)
- **Image Processing:** Built-in Cloudflare Workers capabilities
- **MCP Integration:** @modelcontextprotocol/sdk and @hono/mcp for AI assistant connectivity

## 2. Database Schema Design

This API is stateless and does not require persistent data storage. All processing is done in real-time with temporary image storage in R2.

## 3. API Endpoints

We will structure our API endpoints for image upload, processing, and health checking.

### 3.1. Note Processing Endpoints

- **POST /api/process-note**
  - Description: Upload handwritten note image and convert to structured JSON
  - Content-Type: multipart/form-data or application/json (base64 encoded image)
  - Expected Payload (multipart):
    ```
    image: File (jpg, png, webp)
    options?: {
      "category_hints": ["meeting", "todo", "idea"],
      "extract_dates": true,
      "extract_contacts": false
    }
    ```
  - Expected Payload (JSON):
    ```json
    {
      "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
      "options": {
        "category_hints": ["meeting", "todo", "idea"],
        "extract_dates": true,
        "extract_contacts": false
      }
    }
    ```
  - Response:
    ```json
    {
      "success": true,
      "data": {
        "title": "Weekly Team Meeting",
        "content": "Discuss Q1 goals and project timeline",
        "category": "meeting",
        "tags": ["team", "goals", "timeline"],
        "dates": ["2024-01-15"],
        "contacts": [],
        "confidence": 0.92,
        "raw_text": "Weekly Team Meeting\nDiscuss Q1 goals and project timeline"
      },
      "processing_time_ms": 1250
    }
    ```

- **GET /api/health**
  - Description: Health check endpoint
  - Response:
    ```json
    {
      "status": "healthy",
      "timestamp": "2024-01-15T10:30:00Z",
      "version": "1.0.0"
    }
    ```

### 3.2. Image Storage Endpoints

- **GET /api/images/:imageId**
  - Description: Retrieve temporarily stored images (for debugging/verification)
  - Response: Image file with appropriate content-type headers
  - Note: Images are automatically cleaned up after 1 hour

## 4. Integrations

### 4.1. Google Gemini API Integration
- Use Google Gemini API for vision processing and text extraction
- Configure with provided API key: `AIzaSyA4XsfhdyOXU8wYV8VCfxPgWYR61oFPuxE`
- Implement structured prompting to extract specific fields from handwritten content
- Handle rate limiting and error responses gracefully

### 4.2. Cloudflare R2 Storage
- Temporary storage for uploaded images during processing
- Automatic cleanup of images after processing completion
- Generate signed URLs for image access if needed

## 5. Processing Logic

### 5.1. Image Preprocessing
- Validate image format and size (max 10MB)
- Convert to optimal format for Gemini API processing
- Store temporarily in R2 with unique identifier

### 5.2. OCR and Structure Extraction
- Send image to Gemini API with structured prompt
- Extract handwritten text using vision capabilities
- Parse content into structured fields:
  - **title**: Main heading or subject of the note
  - **content**: Body text and main content
  - **category**: Inferred category (meeting, todo, idea, note, etc.)
  - **tags**: Relevant keywords and topics
  - **dates**: Extracted dates and deadlines
  - **contacts**: Names and contact information (if enabled)
  - **confidence**: Processing confidence score
  - **raw_text**: Unprocessed extracted text

### 5.3. Response Formatting
- Return structured JSON with consistent schema
- Include processing metadata and confidence scores
- Handle partial extraction gracefully

## 6. MCP Server Integration

### 6.1. MCP Protocol Endpoint
- **POST /mcp** - MCP protocol endpoint for AI assistant integration
  - Handles JSON-RPC requests over HTTP
  - Uses StreamableHTTPTransport for Hono integration
  - Provides tools and resources for handwritten note processing

### 6.2. MCP Tools
- **process_handwritten_note**
  - Description: Convert handwritten note images to structured JSON
  - Input: base64 encoded image data and processing options
  - Output: Structured JSON with title, content, category, tags, etc.
  - Same functionality as REST API but accessible via MCP protocol

- **get_processing_history**
  - Description: Retrieve recent processing history (if implemented)
  - Input: Optional limit parameter
  - Output: List of recently processed notes

### 6.3. MCP Resources
- **processed-notes://recent** - Access recently processed notes
- **processed-notes://{id}** - Access specific processed note by ID

### 6.4. MCP Server Configuration
- Server name: "handwritten-note-ocr-server"
- Version: "1.0.0"
- Description: "MCP server for converting handwritten notes to structured JSON"

## 7. Additional Notes

### 7.1. Environment Variables
The following environment variables should be configured:
- `GOOGLE_GEMINI_API_KEY`: Google Gemini API key for vision processing
- `R2`: Cloudflare R2 binding for image storage

### 7.2. Error Handling
- Implement comprehensive error handling for API failures
- Return meaningful error messages for invalid images
- Handle Gemini API rate limits and quota exceeded scenarios

### 7.3. Security Considerations
- Validate and sanitize all uploaded images
- Implement file size and type restrictions
- Ensure temporary image cleanup to prevent storage bloat
- Rate limiting on API endpoints to prevent abuse

## 8. Further Reading

Take inspiration from the project template here: https://github.com/fiberplane/create-honc-app/tree/main/templates/d1

For Google Gemini API integration, refer to the official documentation for vision processing and structured output generation.
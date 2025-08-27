# Handwritten Note OCR API

A Cloudflare Workers API that converts handwritten note images into structured JSON output using Google Gemini Vision API. Upload images of handwritten notes and receive organized data with extracted titles, content, categories, tags, dates, and more.

## Prerequisites

- Node.js (version 18 or higher)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally
- A Cloudflare account
- Google Gemini API key

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Authentication

Authenticate with Cloudflare:

```bash
wrangler auth login
```

### 3. Configuration

Update the `name` field in `wrangler.jsonc` to your desired app name:

```jsonc
{
  "name": "handwritten-note-ocr-o0lc84",
  // ... other config
}
```

### 4. R2 Storage Setup

This project uses Cloudflare R2 for temporary image storage during processing.

1. **Create an R2 bucket:**
   ```bash
   wrangler r2 bucket create handwritten-notes-temp
   ```

2. **Update wrangler.jsonc with your R2 bucket:**
   ```jsonc
   {
     "r2_buckets": [
       {
         "binding": "R2",
         "bucket_name": "handwritten-notes-temp"
       }
     ]
   }
   ```

### 5. Environment Variables

Set up your Google Gemini API key as a secret:

```bash
wrangler secret put GOOGLE_GEMINI_API_KEY
```

When prompted, enter your Google Gemini API key: `AIzaSyA4XsfhdyOXU8wYV8VCfxPgWYR61oFPuxE`

## Development

Start the development server:

```bash
npm run dev
```

Your worker will be available at `http://localhost:8787`

### API Endpoints

- **POST /api/process-note** - Upload and process handwritten note images
- **GET /api/health** - Health check endpoint
- **GET /api/images/:imageId** - Retrieve temporarily stored images
- **GET /openapi.json** - OpenAPI specification
- **GET /fp/** - Fiberplane API explorer

### Testing the API

You can test the API using curl or any HTTP client:

```bash
# Health check
curl http://localhost:8787/api/health

# Process a handwritten note (multipart form)
curl -X POST http://localhost:8787/api/process-note \
  -F "image=@path/to/your/handwritten-note.jpg" \
  -F 'options={"category_hints":["meeting","todo"],"extract_dates":true}'

# Process a handwritten note (JSON with base64)
curl -X POST http://localhost:8787/api/process-note \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
    "options": {
      "category_hints": ["meeting", "todo", "idea"],
      "extract_dates": true,
      "extract_contacts": false
    }
  }'
```

## Deployment

Deploy to Cloudflare:

```bash
npm run deploy
```

After deployment, your API will be available at `https://handwritten-note-ocr-o0lc84.your-subdomain.workers.dev`

## API Usage

### Processing Options

The API accepts the following processing options:

- `category_hints`: Array of suggested categories to focus on
- `extract_dates`: Boolean to enable/disable date extraction (default: true)
- `extract_contacts`: Boolean to enable/disable contact extraction (default: false)

### Response Format

Successful processing returns:

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

### Image Requirements

- **Supported formats**: JPG, PNG, WebP
- **Maximum size**: 10MB
- **Recommended**: Clear, well-lit images of handwritten text

## Troubleshooting

### Common Issues

1. **Google Gemini API errors**: Ensure your API key is correctly set using `wrangler secret put GOOGLE_GEMINI_API_KEY`

2. **R2 bucket access errors**: Verify your R2 bucket exists and the binding name matches in `wrangler.jsonc`

3. **Image upload failures**: Check that images are under 10MB and in supported formats (JPG, PNG, WebP)

4. **Authentication issues**: Run `wrangler auth login` and ensure you're logged in to the correct Cloudflare account

5. **Name conflicts**: If you get naming conflicts during deployment, change the `name` field in `wrangler.jsonc` to something unique

6. **Quota exceeded errors**: The API will return a 429 status code if Google Gemini API quota is exceeded

### Local Development Issues

- Images are stored temporarily in R2 and cleaned up after 1 hour
- For debugging, you can access stored images via `/api/images/:imageId`
- Check the browser console and worker logs for detailed error messages

## Features

- **OCR Processing**: Extracts text from handwritten notes using Google Gemini Vision
- **Structured Output**: Organizes content into title, body, category, tags, and metadata
- **Date Extraction**: Automatically identifies dates and deadlines in notes
- **Contact Extraction**: Optional extraction of names and contact information
- **Temporary Storage**: Secure temporary image storage with automatic cleanup
- **Confidence Scoring**: Provides confidence scores for extraction accuracy
- **Multiple Input Formats**: Supports both multipart form data and JSON with base64 images

## Next Steps

- Explore the API using the Fiberplane explorer at `/fp/`
- Review the OpenAPI specification at `/openapi.json`
- Integrate the API into your applications for handwritten note digitization
- Consider implementing batch processing for multiple images
- Add custom category training for domain-specific note types

## Getting Help

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [R2 Storage Documentation](https://developers.cloudflare.com/r2/)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [Hono.js Documentation](https://hono.dev/)
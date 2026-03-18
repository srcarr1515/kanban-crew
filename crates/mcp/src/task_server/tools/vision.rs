use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use rmcp::{
    ErrorData, handler::server::tool::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};

use super::McpServer;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct DescribeImageRequest {
    #[schemars(
        description = "Absolute file path or HTTP(S) URL of the image to describe. Supports PNG, JPEG, GIF, and WebP."
    )]
    image: String,
    #[schemars(
        description = "Prompt describing what you want to know about the image. For example: 'Describe the UI layout in this screenshot' or 'What colors are used in this mockup?'"
    )]
    prompt: String,
}

#[derive(Debug, Serialize)]
struct VisionApiRequest {
    base64: String,
    mime_type: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct VisionApiResponse {
    description: String,
}

#[tool_router(router = vision_tools_router, vis = "pub")]
impl McpServer {
    /// Describe an image using the configured vision model.
    /// Reads a local file or fetches a URL, sends it to the global vision model
    /// with the given prompt, and returns the model's text description.
    #[tool(
        description = "Describe an image using the configured vision model. Accepts a local file path or HTTP URL. Sends the image to the global vision model with your prompt and returns a text description. Useful for interpreting screenshots, mockups, diagrams, or design assets."
    )]
    async fn describe_image(
        &self,
        Parameters(DescribeImageRequest { image, prompt }): Parameters<DescribeImageRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        // 0. Check mcp.vision permission
        if !self.has_mcp_permission("mcp.vision") {
            return McpServer::err(
                "Permission denied: mcp.vision is not enabled for this crew member",
                None::<&str>,
            );
        }

        // 1. Resolve the image to base64 + mime_type
        let (b64, mime_type) = match resolve_image(&self.client, &image).await {
            Ok(v) => v,
            Err(e) => return McpServer::err("Failed to load image", Some(&e)),
        };

        // 2. Call the backend vision/describe endpoint
        let url = self.url("/api/local/vision/describe");
        let payload = VisionApiRequest {
            base64: b64,
            mime_type,
            prompt,
        };

        let resp = match self.client.post(&url).json(&payload).send().await {
            Ok(r) => r,
            Err(e) => {
                return McpServer::err(
                    "Failed to connect to VK backend for vision",
                    Some(&e.to_string()),
                );
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return McpServer::err(&format!("Vision API returned {status}"), Some(&body));
        }

        let api_resp: crate::ApiResponseEnvelope<VisionApiResponse> = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                return McpServer::err("Failed to parse vision response", Some(&e.to_string()));
            }
        };

        if !api_resp.success {
            let msg = api_resp
                .message
                .as_deref()
                .unwrap_or("Unknown vision error");
            return McpServer::err("Vision API error", Some(msg));
        }

        match api_resp.data {
            Some(data) => McpServer::success(&data.description),
            None => McpServer::err("Vision API returned empty response", None::<&str>),
        }
    }
}

/// Resolve an image reference (file path or URL) to (base64_data, mime_type).
async fn resolve_image(client: &reqwest::Client, image: &str) -> Result<(String, String), String> {
    if image.starts_with("http://") || image.starts_with("https://") {
        // Fetch from URL
        let resp = client
            .get(image)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch image URL: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Image URL returned status {}", resp.status()));
        }

        // Determine MIME from Content-Type header, fall back to extension guess
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());

        let mime_type = content_type
            .or_else(|| mime_from_path(image))
            .unwrap_or_else(|| "image/png".to_string());

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read image bytes: {e}"))?;

        Ok((BASE64.encode(&bytes), mime_type))
    } else {
        // Read from local file
        let bytes = tokio::fs::read(&image)
            .await
            .map_err(|e| format!("Failed to read file '{}': {}", image, e))?;

        let mime_type = mime_from_path(image).unwrap_or_else(|| "image/png".to_string());

        Ok((BASE64.encode(&bytes), mime_type))
    }
}

/// Guess MIME type from a file path or URL using the extension.
fn mime_from_path(path: &str) -> Option<String> {
    mime_guess::from_path(path).first().map(|m| m.to_string())
}

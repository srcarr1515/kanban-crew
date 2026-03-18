use axum::{Router, extract::State, response::Json as ResponseJson, routing::post};
use deployment::Deployment;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

// ── Request / Response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DescribeImageRequest {
    /// Base64-encoded image data
    pub base64: String,
    /// MIME type (e.g. "image/png")
    pub mime_type: String,
    /// Prompt describing what to extract from the image
    pub prompt: String,
}

#[derive(Debug, Serialize)]
pub struct DescribeImageResponse {
    pub description: String,
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/local/vision/describe", post(describe_image))
}

// ── Handler ─────────────────────────────────────────────────────────────────

async fn describe_image(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Json(request): axum::extract::Json<DescribeImageRequest>,
) -> Result<ResponseJson<ApiResponse<DescribeImageResponse>>, ApiError> {
    // Read config and extract all needed values as owned strings before dropping the lock.
    let (provider_id, model, api_key, base_url) = {
        let config = deployment.config().read().await;
        let vision_config = &config.vision_model;

        let pid = vision_config.provider.clone().ok_or_else(|| {
            ApiError::BadRequest(
                "No vision model configured. Set it in Settings > AI Providers.".to_string(),
            )
        })?;
        let mdl = vision_config.model.clone().ok_or_else(|| {
            ApiError::BadRequest(
                "No vision model configured. Set it in Settings > AI Providers.".to_string(),
            )
        })?;

        let provider_entry = config
            .ai_providers
            .providers
            .iter()
            .find(|p| p.id == pid && p.enabled);

        let key = provider_entry
            .and_then(|p| p.api_key.clone())
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
            .ok_or_else(|| {
                ApiError::BadRequest(format!(
                    "No API key configured for vision provider \"{pid}\". \
                     Set it in Settings > AI Providers."
                ))
            })?;

        let url = provider_entry
            .and_then(|p| p.base_url.clone())
            .unwrap_or_else(|| match pid.as_str() {
                "openai" => "https://api.openai.com".to_string(),
                "google" => "https://generativelanguage.googleapis.com".to_string(),
                "openrouter" => "https://openrouter.ai/api".to_string(),
                _ => "https://api.anthropic.com".to_string(),
            });

        (pid, mdl, key, url)
    };

    let client = Client::new();
    let is_openai = matches!(provider_id.as_str(), "openai" | "openrouter");

    let description = if is_openai {
        call_openai_vision(&client, &base_url, &api_key, &model, &request).await?
    } else {
        call_anthropic_vision(&client, &base_url, &api_key, &model, &request).await?
    };

    Ok(ResponseJson(ApiResponse::success(DescribeImageResponse {
        description,
    })))
}

// ── OpenAI-compatible vision call ───────────────────────────────────────────

async fn call_openai_vision(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &DescribeImageRequest,
) -> Result<String, ApiError> {
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{};base64,{}", request.mime_type, request.base64),
                    }
                },
                {
                    "type": "text",
                    "text": request.prompt,
                }
            ]
        }]
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Vision API error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(ApiError::BadRequest(format!(
            "Vision API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse vision response: {e}")))?;

    json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("Unexpected vision API response format".to_string()))
}

// ── Anthropic-compatible vision call ────────────────────────────────────────

async fn call_anthropic_vision(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &DescribeImageRequest,
) -> Result<String, ApiError> {
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": request.mime_type,
                        "data": request.base64,
                    }
                },
                {
                    "type": "text",
                    "text": request.prompt,
                }
            ]
        }]
    });

    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Vision API error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(ApiError::BadRequest(format!(
            "Vision API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse vision response: {e}")))?;

    // Anthropic returns { content: [{ type: "text", text: "..." }] }
    json.get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|block| {
                if block.get("type")?.as_str()? == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| ApiError::BadRequest("Unexpected vision API response format".to_string()))
}

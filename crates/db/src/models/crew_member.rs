use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct CrewMember {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub avatar: String,
    pub role_prompt: String,
    pub tool_access: String,
    pub personality: String,
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

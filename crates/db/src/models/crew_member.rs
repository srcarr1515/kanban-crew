use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct CrewMember {
    pub id: String,
    pub name: String,
    pub role: String,
    pub avatar: String,
    pub role_prompt: String,
    pub tool_access: String,
    pub personality: String,
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    pub skills: Option<String>,
    pub can_create_workspace: bool,
    pub can_merge_workspace: bool,
    pub can_propose_tasks: bool,
    pub can_query_database: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

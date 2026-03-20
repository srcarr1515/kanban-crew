use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub default_agent_working_dir: Option<String>,
    pub remote_project_id: Option<Uuid>,
    pub auto_pickup_enabled: bool,
    pub default_repo_id: Option<Uuid>,
    pub default_branch: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

impl Project {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Project>(
            r#"SELECT id, name, default_agent_working_dir, remote_project_id,
                      auto_pickup_enabled, default_repo_id, default_branch, created_at, updated_at
               FROM projects
               ORDER BY created_at DESC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Project>(
            r#"SELECT id, name, default_agent_working_dir, remote_project_id,
                      auto_pickup_enabled, default_repo_id, default_branch, created_at, updated_at
               FROM projects
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn set_auto_pickup_enabled(
        pool: &SqlitePool,
        id: Uuid,
        enabled: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE projects
               SET auto_pickup_enabled = ?, updated_at = datetime('now', 'subsec')
               WHERE id = ?"#,
        )
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn set_remote_project_id(
        pool: &SqlitePool,
        id: Uuid,
        remote_project_id: Option<Uuid>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE projects
               SET remote_project_id = ?
               WHERE id = ?"#,
        )
        .bind(remote_project_id)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

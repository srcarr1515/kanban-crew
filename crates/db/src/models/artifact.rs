use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Artifact {
    pub id: String,
    pub task_id: Uuid,
    pub crew_member_id: Option<String>,
    pub artifact_type: String,
    pub title: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Artifact {
    pub async fn list_by_task(pool: &SqlitePool, task_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Artifact>(
            r#"SELECT id, task_id, crew_member_id, artifact_type, title, content, created_at, updated_at
               FROM artifacts
               WHERE task_id = ?
               ORDER BY created_at ASC"#,
        )
        .bind(task_id)
        .fetch_all(pool)
        .await
    }

    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Artifact>(
            r#"SELECT id, task_id, crew_member_id, artifact_type, title, content, created_at, updated_at
               FROM artifacts
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        task_id: Uuid,
        crew_member_id: Option<&str>,
        artifact_type: &str,
        title: &str,
        content: &str,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        sqlx::query_as::<_, Artifact>(
            r#"INSERT INTO artifacts (id, task_id, crew_member_id, artifact_type, title, content)
               VALUES (?, ?, ?, ?, ?, ?)
               RETURNING id, task_id, crew_member_id, artifact_type, title, content, created_at, updated_at"#,
        )
        .bind(&id)
        .bind(task_id)
        .bind(crew_member_id)
        .bind(artifact_type)
        .bind(title)
        .bind(content)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        crew_member_id: Option<&str>,
        artifact_type: &str,
        title: &str,
        content: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Artifact>(
            r#"UPDATE artifacts
               SET crew_member_id = ?, artifact_type = ?, title = ?, content = ?,
                   updated_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id, task_id, crew_member_id, artifact_type, title, content, created_at, updated_at"#,
        )
        .bind(crew_member_id)
        .bind(artifact_type)
        .bind(title)
        .bind(content)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM artifacts WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

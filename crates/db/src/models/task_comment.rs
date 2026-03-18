use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct TaskComment {
    pub id: String,
    pub task_id: Uuid,
    pub author_type: String,
    pub author_name: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

impl TaskComment {
    pub async fn list_by_task(pool: &SqlitePool, task_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, TaskComment>(
            r#"SELECT id, task_id, author_type, author_name, content, created_at
               FROM task_comments
               WHERE task_id = ?
               ORDER BY created_at ASC"#,
        )
        .bind(task_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        task_id: Uuid,
        author_type: &str,
        author_name: &str,
        content: &str,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        sqlx::query_as::<_, TaskComment>(
            r#"INSERT INTO task_comments (id, task_id, author_type, author_name, content)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id, task_id, author_type, author_name, content, created_at"#,
        )
        .bind(&id)
        .bind(task_id)
        .bind(author_type)
        .bind(author_name)
        .bind(content)
        .fetch_one(pool)
        .await
    }
}

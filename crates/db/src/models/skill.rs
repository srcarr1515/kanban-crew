use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub trigger_description: String,
    pub content: String,
    pub is_system: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Skill {
    pub async fn list(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Skill>(
            r#"SELECT id, name, description, trigger_description, content, is_system, created_at, updated_at
               FROM skills
               ORDER BY name ASC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Skill>(
            r#"SELECT id, name, description, trigger_description, content, is_system, created_at, updated_at
               FROM skills
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn get_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Skill>(
            r#"SELECT id, name, description, trigger_description, content, is_system, created_at, updated_at
               FROM skills
               WHERE name = ?"#,
        )
        .bind(name)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        name: &str,
        description: &str,
        trigger_description: &str,
        content: &str,
        is_system: bool,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        sqlx::query_as::<_, Skill>(
            r#"INSERT INTO skills (id, name, description, trigger_description, content, is_system)
               VALUES (?, ?, ?, ?, ?, ?)
               RETURNING id, name, description, trigger_description, content, is_system, created_at, updated_at"#,
        )
        .bind(&id)
        .bind(name)
        .bind(description)
        .bind(trigger_description)
        .bind(content)
        .bind(is_system)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        name: &str,
        description: &str,
        trigger_description: &str,
        content: &str,
        is_system: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Skill>(
            r#"UPDATE skills
               SET name = ?, description = ?, trigger_description = ?, content = ?,
                   is_system = ?, updated_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id, name, description, trigger_description, content, is_system, created_at, updated_at"#,
        )
        .bind(name)
        .bind(description)
        .bind(trigger_description)
        .bind(content)
        .bind(is_system)
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM skills WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

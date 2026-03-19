use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;

use super::skill::Skill;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct CrewMemberSkill {
    pub crew_member_id: String,
    pub skill_id: String,
    pub sort_order: i64,
}

impl CrewMemberSkill {
    /// List all skill associations for a crew member, ordered by sort_order.
    pub async fn list_for_crew_member(
        pool: &SqlitePool,
        crew_member_id: &str,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, CrewMemberSkill>(
            r#"SELECT crew_member_id, skill_id, sort_order
               FROM crew_member_skills
               WHERE crew_member_id = ?
               ORDER BY sort_order ASC"#,
        )
        .bind(crew_member_id)
        .fetch_all(pool)
        .await
    }

    /// List all skill associations for a crew member, returning full Skill objects.
    pub async fn list_skills_for_crew_member(
        pool: &SqlitePool,
        crew_member_id: &str,
    ) -> Result<Vec<Skill>, sqlx::Error> {
        sqlx::query_as::<_, Skill>(
            r#"SELECT s.id, s.name, s.description, s.trigger_description, s.content,
                      s.is_system, s.created_at, s.updated_at
               FROM skills s
               INNER JOIN crew_member_skills cms ON cms.skill_id = s.id
               WHERE cms.crew_member_id = ?
               ORDER BY cms.sort_order ASC"#,
        )
        .bind(crew_member_id)
        .fetch_all(pool)
        .await
    }

    /// Add a skill to a crew member.
    pub async fn create(
        pool: &SqlitePool,
        crew_member_id: &str,
        skill_id: &str,
        sort_order: i64,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, CrewMemberSkill>(
            r#"INSERT INTO crew_member_skills (crew_member_id, skill_id, sort_order)
               VALUES (?, ?, ?)
               RETURNING crew_member_id, skill_id, sort_order"#,
        )
        .bind(crew_member_id)
        .bind(skill_id)
        .bind(sort_order)
        .fetch_one(pool)
        .await
    }

    /// Update the sort_order for a crew member skill association.
    pub async fn update_sort_order(
        pool: &SqlitePool,
        crew_member_id: &str,
        skill_id: &str,
        sort_order: i64,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, CrewMemberSkill>(
            r#"UPDATE crew_member_skills
               SET sort_order = ?
               WHERE crew_member_id = ? AND skill_id = ?
               RETURNING crew_member_id, skill_id, sort_order"#,
        )
        .bind(sort_order)
        .bind(crew_member_id)
        .bind(skill_id)
        .fetch_one(pool)
        .await
    }

    /// Remove a skill from a crew member.
    pub async fn delete(
        pool: &SqlitePool,
        crew_member_id: &str,
        skill_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM crew_member_skills WHERE crew_member_id = ? AND skill_id = ?")
            .bind(crew_member_id)
            .bind(skill_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Replace all skill associations for a crew member (bulk set).
    pub async fn replace_all(
        pool: &SqlitePool,
        crew_member_id: &str,
        skills: &[(String, i64)], // (skill_id, sort_order)
    ) -> Result<Vec<Self>, sqlx::Error> {
        let mut tx = pool.begin().await?;

        sqlx::query("DELETE FROM crew_member_skills WHERE crew_member_id = ?")
            .bind(crew_member_id)
            .execute(&mut *tx)
            .await?;

        for (skill_id, sort_order) in skills {
            sqlx::query(
                "INSERT INTO crew_member_skills (crew_member_id, skill_id, sort_order) VALUES (?, ?, ?)",
            )
            .bind(crew_member_id)
            .bind(skill_id)
            .bind(sort_order)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Self::list_for_crew_member(pool, crew_member_id).await
    }
}

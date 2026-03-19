use std::collections::HashMap;

use db::models::skill::Skill;
use rust_embed::RustEmbed;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(RustEmbed)]
#[folder = "default_skills"]
struct DefaultSkillFiles;

/// A skill entry from disk (embedded default skills).
#[derive(Debug, Clone, Serialize, TS)]
pub struct DiskSkill {
    pub name: String,
    pub description: String,
    pub trigger_description: String,
    pub content: String,
}

/// In-memory index of default skills loaded from embedded files on startup.
#[derive(Debug, Clone)]
pub struct SkillRegistry {
    /// name → DiskSkill
    skills: HashMap<String, DiskSkill>,
}

impl SkillRegistry {
    /// Build the registry by scanning embedded default skill files.
    pub fn load() -> Self {
        let mut skills = HashMap::new();

        for filename in DefaultSkillFiles::iter() {
            let Some(file) = DefaultSkillFiles::get(&filename) else {
                continue;
            };
            let Ok(raw) = std::str::from_utf8(&file.data) else {
                tracing::warn!("Skipping non-UTF-8 skill file: {}", filename);
                continue;
            };

            // Derive skill name from filename (strip .md extension)
            let name = filename
                .strip_suffix(".md")
                .unwrap_or(&filename)
                .to_string();

            match parse_skill_file(&name, raw) {
                Ok(skill) => {
                    tracing::info!("Loaded default skill: {}", skill.name);
                    skills.insert(skill.name.clone(), skill);
                }
                Err(e) => {
                    tracing::warn!("Failed to parse skill file {}: {}", filename, e);
                }
            }
        }

        tracing::info!("Skill registry loaded {} default skills", skills.len());
        Self { skills }
    }

    /// All disk skills as a slice-like iterator.
    pub fn disk_skills(&self) -> impl Iterator<Item = &DiskSkill> {
        self.skills.values()
    }

    /// Look up a disk skill by name.
    pub fn get_by_name(&self, name: &str) -> Option<&DiskSkill> {
        self.skills.get(name)
    }

    /// Seed all default skills into the database as system skills.
    ///
    /// For each disk skill:
    /// - If no DB row exists with that name, insert it with `is_system = true`.
    /// - If a system skill already exists, update its content so new versions propagate.
    /// - If a user-created skill has the same name, leave it untouched.
    pub async fn seed_system_skills(&self, pool: &SqlitePool) -> Result<(), sqlx::Error> {
        for disk in self.skills.values() {
            match Skill::get_by_name(pool, &disk.name).await? {
                Some(existing) if existing.is_system => {
                    // Update content for existing system skills (pick up new versions)
                    if existing.description != disk.description
                        || existing.trigger_description != disk.trigger_description
                        || existing.content != disk.content
                    {
                        Skill::update(
                            pool,
                            &existing.id,
                            &disk.name,
                            &disk.description,
                            &disk.trigger_description,
                            &disk.content,
                            true,
                        )
                        .await?;
                        tracing::info!("Updated system skill: {}", disk.name);
                    }
                }
                Some(_) => {
                    // User-created skill with same name — don't overwrite
                    tracing::debug!(
                        "Skipping seed for '{}': user-created skill exists",
                        disk.name
                    );
                }
                None => {
                    Skill::create(
                        pool,
                        &disk.name,
                        &disk.description,
                        &disk.trigger_description,
                        &disk.content,
                        true,
                    )
                    .await?;
                    tracing::info!("Seeded system skill: {}", disk.name);
                }
            }
        }
        Ok(())
    }
}

/// Parse a skill markdown file with YAML frontmatter.
///
/// Expected format:
/// ```text
/// ---
/// description: ...
/// trigger_description: ...
/// ---
/// <markdown content>
/// ```
fn parse_skill_file(name: &str, raw: &str) -> Result<DiskSkill, String> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return Err("missing YAML frontmatter delimiter".into());
    }

    // Find the closing --- delimiter
    let after_open = &trimmed[3..];
    let close_pos = after_open
        .find("\n---")
        .ok_or("missing closing frontmatter delimiter")?;

    let frontmatter = &after_open[..close_pos];
    let content = after_open[close_pos + 4..].trim().to_string();

    let mut description = String::new();
    let mut trigger_description = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("trigger_description:") {
            trigger_description = val.trim().to_string();
        }
    }

    Ok(DiskSkill {
        name: name.to_string(),
        description,
        trigger_description,
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill_file() {
        let raw = r#"---
description: A test skill
trigger_description: Use for testing
---
# Test Skill

Some content here."#;
        let skill = parse_skill_file("test", raw).unwrap();
        assert_eq!(skill.name, "test");
        assert_eq!(skill.description, "A test skill");
        assert_eq!(skill.trigger_description, "Use for testing");
        assert!(skill.content.contains("# Test Skill"));
        assert!(skill.content.contains("Some content here."));
    }

    #[test]
    fn test_parse_missing_frontmatter() {
        let raw = "# No frontmatter\nJust content.";
        assert!(parse_skill_file("bad", raw).is_err());
    }

    #[test]
    fn test_registry_loads_defaults() {
        let registry = SkillRegistry::load();
        // We ship 11 default skills (5 activity + 6 role)
        assert!(registry.skills.len() >= 11);
        // Activity skills
        assert!(registry.get_by_name("brainstorming").is_some());
        assert!(registry.get_by_name("planning").is_some());
        assert!(registry.get_by_name("tdd").is_some());
        assert!(registry.get_by_name("debugging").is_some());
        assert!(registry.get_by_name("verification").is_some());
        // Role skills
        assert!(registry.get_by_name("developer").is_some());
        assert!(registry.get_by_name("qa-engineer").is_some());
        assert!(registry.get_by_name("product-manager").is_some());
        assert!(registry.get_by_name("ux-designer").is_some());
        assert!(registry.get_by_name("technical-writer").is_some());
        assert!(registry.get_by_name("code-reviewer").is_some());
    }
}

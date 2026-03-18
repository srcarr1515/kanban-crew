mod handler;
mod tools;

use std::{collections::HashSet, path::Path};

use anyhow::Context;
use db::models::{requests::ContainerQuery, workspace::WorkspaceContext};
use rmcp::{handler::server::tool::ToolRouter, schemars};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) use crate::ApiResponseEnvelope;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
pub struct McpRepoContext {
    #[schemars(description = "The unique identifier of the repository")]
    pub repo_id: Uuid,
    #[schemars(description = "The name of the repository")]
    pub repo_name: String,
    #[schemars(description = "The target branch for this repository in this workspace")]
    pub target_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
pub struct McpContext {
    #[schemars(description = "The organization ID (if workspace is linked to remote)")]
    pub organization_id: Option<Uuid>,
    #[schemars(description = "The remote project ID (if workspace is linked to remote)")]
    pub project_id: Option<Uuid>,
    #[schemars(description = "The remote issue ID (if workspace is linked to a remote issue)")]
    pub issue_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "The orchestrator session ID when running in orchestrator mode")]
    pub orchestrator_session_id: Option<Uuid>,
    pub workspace_id: Uuid,
    pub workspace_branch: String,
    #[schemars(
        description = "Repository info and target branches for each repo in this workspace"
    )]
    pub workspace_repos: Vec<McpRepoContext>,
}

#[derive(Debug, Clone)]
pub enum McpMode {
    Global,
    Orchestrator,
}

#[derive(Debug, Clone)]
pub struct McpServer {
    client: reqwest::Client,
    base_url: String,
    tool_router: ToolRouter<McpServer>,
    context: Option<McpContext>,
    mode: McpMode,
    /// MCP permission flags granted to the current crew member (e.g. `"mcp.vision"`).
    /// `None` means all permissions are granted (backward-compat / global mode).
    mcp_permissions: Option<HashSet<String>>,
}

impl McpServer {
    pub fn new_global(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.to_string(),
            tool_router: Self::global_mode_router(),
            context: None,
            mode: McpMode::Global,
            mcp_permissions: None, // global mode grants all permissions
        }
    }

    pub fn new_orchestrator(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.to_string(),
            tool_router: Self::orchestrator_mode_router(),
            context: None,
            mode: McpMode::Orchestrator,
            mcp_permissions: None,
        }
    }

    fn url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    pub async fn init(mut self) -> anyhow::Result<Self> {
        let result = self.fetch_context_at_startup().await?;

        if let Some((mcp_context, tool_access_json)) = result {
            tracing::info!("VK context loaded, get_context tool available");
            self.context = Some(mcp_context);

            // Enforce crew member tool_access: if the assigned crew member has a
            // non-empty tool_access array, remove any tools not in the allowlist.
            self.apply_tool_access_filter(tool_access_json.as_deref());
        } else {
            self.tool_router.map.remove("get_context");
            tracing::debug!("VK context not available, get_context tool will not be registered");
        }

        // Load MCP permission flags from environment.
        // When set, only the listed permissions are granted. When absent, all
        // permissions are granted (backward-compat for global mode & legacy
        // orchestrators).
        if let Ok(raw) = std::env::var("VK_MCP_PERMISSIONS") {
            let perms: HashSet<String> = raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            tracing::info!(?perms, "MCP permission flags loaded from environment");
            self.mcp_permissions = Some(perms);
        }

        Ok(self)
    }

    /// Returns `true` if the given MCP permission flag is granted.
    /// When no explicit permission set is configured (e.g. global mode),
    /// all permissions are granted.
    pub fn has_mcp_permission(&self, perm: &str) -> bool {
        match &self.mcp_permissions {
            None => true,
            Some(set) => set.contains(perm),
        }
    }

    /// Parses a tool_access JSON string and removes tools not in the allowlist.
    /// An empty array or None means unrestricted (all tools allowed).
    fn apply_tool_access_filter(&mut self, tool_access_json: Option<&str>) {
        let allowed: Vec<String> = tool_access_json
            .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
            .unwrap_or_default();

        if allowed.is_empty() {
            return;
        }

        let all_tool_names: Vec<String> =
            self.tool_router.map.keys().map(|k| k.to_string()).collect();
        let mut removed = Vec::new();
        for name in &all_tool_names {
            if !allowed.iter().any(|a| a == name) {
                self.tool_router.map.remove(name.as_str());
                removed.push(name.clone());
            }
        }

        if !removed.is_empty() {
            tracing::info!(
                "Crew member tool_access filter applied. Allowed: {:?}. Removed: {:?}",
                allowed,
                removed
            );
        }
    }

    pub fn mode(&self) -> &McpMode {
        &self.mode
    }

    async fn fetch_context_at_startup(
        &self,
    ) -> anyhow::Result<Option<(McpContext, Option<String>)>> {
        let current_dir = std::env::current_dir().context("Failed to resolve current directory")?;
        let canonical_path = current_dir.canonicalize().unwrap_or(current_dir);
        let normalized_path = utils::path::normalize_macos_private_alias(&canonical_path);

        match self.try_fetch_attempt_context(&normalized_path).await {
            Ok(Some(ctx)) => {
                let tool_access = ctx.tool_access.clone();
                let mcp_ctx = self.build_mcp_context_from_workspace_context(&ctx).await;
                Ok(Some((mcp_ctx, tool_access)))
            }
            Ok(None) | Err(_) if matches!(self.mode(), McpMode::Global) => Ok(None),
            Ok(None) => anyhow::bail!(
                "Failed to load orchestrator MCP context from /api/containers/attempt-context"
            ),
            Err(error) => Err(error.context("Failed to load orchestrator MCP context")),
        }
    }

    async fn try_fetch_attempt_context(
        &self,
        path: &Path,
    ) -> anyhow::Result<Option<WorkspaceContext>> {
        let url = self.url("/api/containers/attempt-context");
        let query = ContainerQuery {
            container_ref: path.to_string_lossy().to_string(),
        };

        let response = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            self.client.get(&url).query(&query).send(),
        )
        .await
        .context("Timed out fetching /api/containers/attempt-context")?
        .context("Failed to fetch /api/containers/attempt-context")?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let api_response: ApiResponseEnvelope<WorkspaceContext> = response
            .json()
            .await
            .context("Failed to parse /api/containers/attempt-context response")?;

        if !api_response.success {
            return Ok(None);
        }

        Ok(api_response.data)
    }

    async fn build_mcp_context_from_workspace_context(&self, ctx: &WorkspaceContext) -> McpContext {
        let workspace_repos: Vec<McpRepoContext> = ctx
            .workspace_repos
            .iter()
            .map(|rwb| McpRepoContext {
                repo_id: rwb.repo.id,
                repo_name: rwb.repo.name.clone(),
                target_branch: rwb.target_branch.clone(),
            })
            .collect();

        let workspace_id = ctx.workspace.id;
        let workspace_branch = ctx.workspace.branch.clone();
        let orchestrator_session_id = if matches!(self.mode(), McpMode::Orchestrator) {
            ctx.orchestrator_session_id
        } else {
            None
        };

        let (project_id, issue_id, organization_id) = self
            .fetch_remote_workspace_context(workspace_id)
            .await
            .unwrap_or((None, None, None));

        McpContext {
            organization_id,
            project_id,
            issue_id,
            orchestrator_session_id,
            workspace_id,
            workspace_branch,
            workspace_repos,
        }
    }

    async fn fetch_remote_workspace_context(
        &self,
        local_workspace_id: Uuid,
    ) -> Option<(Option<Uuid>, Option<Uuid>, Option<Uuid>)> {
        let url = self.url(&format!(
            "/api/remote/workspaces/by-local-id/{}",
            local_workspace_id
        ));

        let response = tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            self.client.get(&url).send(),
        )
        .await
        .ok()?
        .ok()?;

        if !response.status().is_success() {
            return None;
        }

        let api_response: ApiResponseEnvelope<api_types::Workspace> = response.json().await.ok()?;

        if !api_response.success {
            return None;
        }

        let remote_ws = api_response.data?;
        let project_id = remote_ws.project_id;

        // Fetch the project to get organization_id
        let org_id = self.fetch_remote_organization_id(project_id).await;

        Some((Some(project_id), remote_ws.issue_id, org_id))
    }

    async fn fetch_remote_organization_id(&self, project_id: Uuid) -> Option<Uuid> {
        let url = self.url(&format!("/api/remote/projects/{}", project_id));

        let response = tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            self.client.get(&url).send(),
        )
        .await
        .ok()?
        .ok()?;

        if !response.status().is_success() {
            return None;
        }

        let api_response: ApiResponseEnvelope<api_types::Project> = response.json().await.ok()?;
        let project = api_response.data?;
        Some(project.organization_id)
    }
}

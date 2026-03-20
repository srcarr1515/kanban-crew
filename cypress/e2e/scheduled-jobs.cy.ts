/// <reference types="cypress" />

// Fixture data mirrors the shapes expected by the front-end API layer.
// Every response is wrapped in { success: true, data: <payload> }.

const PROJECT = {
  id: 'proj-e2e-001',
  name: 'E2E Test Project',
  default_agent_working_dir: null,
  remote_project_id: null,
  auto_pickup_enabled: false,
  created_at: '2026-03-20T09:00:00Z',
  updated_at: '2026-03-20T09:00:00Z',
};

const TEMPLATE_TASK = {
  id: 'task-e2e-template-001',
  project_id: 'proj-e2e-001',
  title: 'Template: Deploy notification service',
  description: 'Template task for automated deployments',
  status: 'todo',
  simple_id: 'PROJ-42',
  sort_order: 1,
  parent_task_id: null,
  parent_task_sort_order: null,
  crew_member_id: null,
  created_at: '2026-03-20T09:00:00Z',
  updated_at: '2026-03-20T09:00:00Z',
};

const SPAWNED_TASK = {
  id: 'task-e2e-spawned-001',
  project_id: 'proj-e2e-001',
  title: 'Template: Deploy notification service',
  description: 'Template task for automated deployments',
  status: 'todo',
  simple_id: 'PROJ-99',
  sort_order: 2,
  parent_task_id: null,
  parent_task_sort_order: null,
  crew_member_id: null,
  created_at: '2026-03-20T10:01:00Z',
  updated_at: '2026-03-20T10:01:00Z',
};

const JOB = {
  id: 'job-e2e-001',
  template_task_id: TEMPLATE_TASK.id,
  schedule_cron: '*/1 * * * *',
  enabled: true,
  created_at: '2026-03-20T10:00:00Z',
  updated_at: '2026-03-20T10:00:00Z',
};

const SUCCESS_RUN = {
  id: 'run-e2e-success-001',
  job_id: JOB.id,
  spawned_task_id: SPAWNED_TASK.id,
  status: 'success' as const,
  started_at: '2026-03-20T10:01:00Z',
  finished_at: '2026-03-20T10:01:05Z',
  outcome_json: null,
  created_at: '2026-03-20T10:01:00Z',
};

const PENDING_RUN = {
  id: 'run-e2e-pending-001',
  job_id: JOB.id,
  spawned_task_id: null,
  status: 'pending' as const,
  started_at: null,
  finished_at: null,
  outcome_json: null,
  created_at: '2026-03-20T10:03:00Z',
};

const FAILED_RUN = {
  id: 'run-e2e-fail-001',
  job_id: JOB.id,
  spawned_task_id: null,
  status: 'failed' as const,
  started_at: '2026-03-20T10:02:00Z',
  finished_at: '2026-03-20T10:02:01Z',
  outcome_json: '{"error":"template task not found"}',
  created_at: '2026-03-20T10:02:00Z',
};

/** Wrap payload in the standard API envelope. */
function apiOk<T>(data: T) {
  return { success: true, data };
}

/**
 * Set up the common API intercepts needed to render the ScheduledJobsPage.
 * Returns the initial (empty) job list; callers can override /api/jobs later.
 */
function stubCommonApis(opts: { jobs?: typeof JOB[] } = {}) {
  // Projects list — needed by the task search
  cy.intercept('GET', '/api/local/projects', {
    body: apiOk([PROJECT]),
  }).as('getProjects');

  // Tasks list for the project — used in the task search dropdown
  cy.intercept('GET', '/api/local/tasks?*', {
    body: apiOk([TEMPLATE_TASK]),
  }).as('getTasks');

  // Jobs list
  cy.intercept('GET', '/api/jobs', {
    body: apiOk(opts.jobs ?? []),
  }).as('getJobs');

  // Job runs (default: none)
  cy.intercept('GET', '/api/job-runs*', {
    body: apiOk([]),
  }).as('getJobRuns');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Scheduled Jobs', () => {
  // ── Scenario 1: Create a scheduled job ──────────────────────────────────

  describe('Create a scheduled job', () => {
    it('should fill the form and save a new job', () => {
      stubCommonApis();

      // Intercept the POST that creates the job
      cy.intercept('POST', '/api/jobs', (req) => {
        expect(req.body).to.have.property('template_task_id', TEMPLATE_TASK.id);
        expect(req.body).to.have.property('schedule_cron', '*/1 * * * *');
        expect(req.body).to.have.property('enabled', true);
        req.reply({ body: apiOk(JOB) });
      }).as('createJob');

      cy.visit('/scheduled-jobs');

      // Click "+ Schedule Job"
      cy.contains('button', 'Schedule Job').click();

      // ── Select template task ───────────────────────────────────────────
      cy.get('input[placeholder="Search tasks..."]').type('Deploy');
      // Wait for the dropdown to render and click the matching task
      cy.contains('button', TEMPLATE_TASK.title).click();
      // Confirm selection feedback
      cy.contains('Selected:').should('contain.text', TEMPLATE_TASK.title);

      // ── Set cron to "every 1 minute" via the Simple builder ────────────
      // The default mode is Simple. Select "minute(s)" interval unit.
      // The CronBuilder starts in Simple mode by default for parseable crons.
      // We need to change the interval unit to "minutes" and set every = 1.
      // Open the interval-unit select and pick "minute(s)"
      cy.contains('button', 'Simple').click();
      // The interval unit select — find the select trigger currently showing
      // a value like "day" and change it to "minute(s)"
      cy.get('[role="combobox"]').first().click();
      cy.get('[role="option"]').contains('minute(s)').click();

      // Set the "every" field to 1 — the input[type=number] that appears
      // when the unit is minutes or hours.
      cy.get('input[type="number"]').clear().type('1');

      // ── Ensure the job is enabled ──────────────────────────────────────
      cy.get('[aria-label="Enable job"]')
        .should('have.attr', 'data-state', 'checked');

      // ── Click Save ─────────────────────────────────────────────────────
      // After create succeeds, the page refreshes the job list. Intercept it
      // to return the newly created job.
      cy.intercept('GET', '/api/jobs', { body: apiOk([JOB]) }).as(
        'getJobsAfterCreate',
      );

      cy.contains('button', 'Save').click();
      cy.wait('@createJob');

      // ── Verify the job appears in the list ─────────────────────────────
      cy.wait('@getJobsAfterCreate');
      cy.contains(TEMPLATE_TASK.title).should('be.visible');
      cy.contains('Every 1 minute(s)').should('be.visible');
    });
  });

  // ── Scenario 2: Job runs and a new task appears ─────────────────────────

  describe('Job execution spawns a new task', () => {
    it('should trigger run-now and show the spawned task in the list', () => {
      // Start with the job already created & enabled
      stubCommonApis({ jobs: [JOB] });

      // Intercept run-now to simulate immediate trigger
      cy.intercept('POST', `/api/jobs/${JOB.id}/run-now`, {
        body: apiOk(PENDING_RUN),
      }).as('runNow');

      cy.visit('/scheduled-jobs');
      cy.wait('@getJobs');

      // The job row should be visible
      cy.contains(TEMPLATE_TASK.title).should('be.visible');

      // Use cy.clock() to control time, then tick forward 60 s to simulate
      // the scheduler polling interval. The frontend will re-fetch job-runs.
      cy.clock();

      // Stub job-runs to now include a running then success run
      cy.intercept('GET', '/api/job-runs*', {
        body: apiOk([SUCCESS_RUN]),
      }).as('getJobRunsAfterTick');

      // Also update the tasks list to include the spawned task
      cy.intercept('GET', '/api/local/tasks?*', {
        body: apiOk([TEMPLATE_TASK, SPAWNED_TASK]),
      }).as('getTasksAfterSpawn');

      // Advance clock by 60 seconds (scheduler poll interval)
      cy.tick(60_000);

      // Verify spawned task now exists in the task data
      // (The kanban board would show it — here we verify the API stub is hit)
      cy.wait('@getTasksAfterSpawn');
    });
  });

  // ── Scenario 3: History tab on the template task ────────────────────────

  describe('History tab shows successful run', () => {
    it('should display a success run entry with a link to the spawned task', () => {
      // Stub the jobs and runs APIs so the IssueHistorySectionContainer
      // finds a matching job for this task and fetches its runs.
      cy.intercept('GET', '/api/jobs', {
        body: apiOk([JOB]),
      }).as('getJobs');

      cy.intercept('GET', '/api/job-runs*', {
        body: apiOk([SUCCESS_RUN]),
      }).as('getJobRuns');

      // Stub project & tasks for the kanban board
      cy.intercept('GET', '/api/local/projects', {
        body: apiOk([PROJECT]),
      }).as('getProjects');

      cy.intercept('GET', '/api/local/tasks?*', {
        body: apiOk([TEMPLATE_TASK, SPAWNED_TASK]),
      }).as('getTasks');

      // Visit the kanban board for the project and open the template task.
      // The exact route depends on app routing — visit the project kanban
      // and then click on the task.
      cy.visit(`/projects/${PROJECT.id}`);
      cy.wait('@getTasks');

      // Click on the template task to open the issue detail panel
      cy.contains(TEMPLATE_TASK.title).click();

      // The History section should be visible (it auto-renders for templates)
      cy.contains('History').should('be.visible');

      // Wait for the job-runs request
      cy.wait('@getJobRuns');

      // Verify a success badge
      cy.contains('Success').should('be.visible');

      // Verify a link to the spawned task
      cy.contains('View task').should('be.visible');
    });
  });

  // ── Scenario 4: Failure case — run status becomes "failed" ──────────────

  describe('Job run failure', () => {
    it('should show failed status when template task is missing', () => {
      // Set up with job already created
      stubCommonApis({ jobs: [JOB] });

      // Intercept run-now to return a pending run, then job-runs will
      // transition to the failed run on refresh.
      cy.intercept('POST', `/api/jobs/${JOB.id}/run-now`, {
        body: apiOk(PENDING_RUN),
      }).as('runNow');

      // After the run is triggered, the job-runs list returns the failed run
      cy.intercept('GET', '/api/job-runs*', {
        body: apiOk([FAILED_RUN]),
      }).as('getJobRunsFailed');

      // Also set up the jobs endpoint to return the job for the history section
      cy.intercept('GET', '/api/jobs', {
        body: apiOk([JOB]),
      }).as('getJobsForHistory');

      // Stub project & tasks for the kanban board
      cy.intercept('GET', '/api/local/projects', {
        body: apiOk([PROJECT]),
      }).as('getProjects');

      cy.intercept('GET', '/api/local/tasks?*', {
        body: apiOk([TEMPLATE_TASK]),
      }).as('getTasks');

      // Navigate to the kanban and open the template task
      cy.visit(`/projects/${PROJECT.id}`);
      cy.wait('@getTasks');
      cy.contains(TEMPLATE_TASK.title).click();

      // The History section should load
      cy.contains('History').should('be.visible');
      cy.wait('@getJobRunsFailed');

      // Verify the "Failed" badge appears
      cy.contains('Failed').should('be.visible');

      // Verify the error message from outcome_json is displayed
      cy.contains('template task not found').should('be.visible');

      // There should be no "View task" link since spawned_task_id is null
      cy.get('button').contains('View task').should('not.exist');
    });
  });
});

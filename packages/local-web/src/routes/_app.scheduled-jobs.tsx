import { createFileRoute } from '@tanstack/react-router';
import { ScheduledJobsPage } from '@/pages/ScheduledJobsPage';

export const Route = createFileRoute('/_app/scheduled-jobs')({
  component: ScheduledJobsPage,
});

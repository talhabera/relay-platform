// Daily report email render (S71). S88 moved it to `@relay/db/report-email`
// so the cron worker, which cannot import web, sends the same email.
export {
  escapeHtml,
  renderDailyReportEmail,
  type DailyReportEmailInput,
  type RenderedEmail,
} from "@relay/db/report-email";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireAgentAccess } from "@/lib/authorization";
import {
  LEAD_LIST_LIMIT,
  countAgentLeadsByStatus,
  listAgentLeads,
  parseLeadStatus,
} from "@/lib/leads-queries";
import { PageHeader } from "@/components/shared/page-header";
import { StatusChip } from "@/components/v2/primitives";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeadNotifyForm } from "@/components/agent/lead-notify-form";

const FILTERS = [
  { label: "All", value: undefined },
  { label: "Qualified", value: "qualified" },
  { label: "New", value: "new" },
  { label: "Rejected", value: "rejected" },
] as const;

export default async function AgentLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status: statusParam } = await searchParams;

  const { agent } = await requireAgentAccess(id);
  if (!agent || agent.kind === "operator") notFound();

  const status = parseLeadStatus(statusParam ?? null);
  const [rows, counts] = await Promise.all([
    listAgentLeads(agent, status),
    countAgentLeadsByStatus(agent),
  ]);
  const total = counts.new + counts.qualified + counts.rejected;
  const exportHref = `/agents/${agent.id}/leads/export${status ? `?status=${status}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${agent.name} — Leads`}
        description={`${counts.qualified} qualified of ${total} total`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={exportHref}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/agents/${agent.id}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to agent
              </Link>
            </Button>
          </div>
        }
      />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Notify on qualified leads</h2>
        <LeadNotifyForm
          agentId={agent.id}
          initialNumber={agent.company.leadNotifyWhatsapp}
        />
      </section>

      <div className="flex gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={filter.value === status ? "default" : "outline"}
            asChild
          >
            <Link
              href={
                filter.value
                  ? `/agents/${agent.id}/leads?status=${filter.value}`
                  : `/agents/${agent.id}/leads`
              }
            >
              {filter.label}
            </Link>
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kod</TableHead>
            <TableHead>Tip</TableHead>
            <TableHead>m²</TableHead>
            <TableHead>Lokasyon</TableHead>
            <TableHead>Bütçe</TableHead>
            <TableHead>İletişim</TableHead>
            <TableHead>Skor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No leads yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>{lead.kod ?? "—"}</TableCell>
                <TableCell>{lead.tip ?? "—"}</TableCell>
                <TableCell>{lead.m2 ?? "—"}</TableCell>
                <TableCell>{lead.lokasyon ?? "—"}</TableCell>
                <TableCell>{lead.butce ?? "—"}</TableCell>
                <TableCell>{lead.iletisim ?? "—"}</TableCell>
                <TableCell>{lead.skor ?? "—"}</TableCell>
                <TableCell>
                  <StatusChip
                    tone={
                      lead.status === "qualified"
                        ? "success"
                        : lead.status === "rejected"
                          ? "error"
                          : "neutral"
                    }
                    className="capitalize"
                  >
                    {lead.status}
                  </StatusChip>
                </TableCell>
                <TableCell>{lead.createdAt.toLocaleDateString("tr-TR")}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {rows.length === LEAD_LIST_LIMIT && (
        <p className="text-sm text-muted-foreground">
          Showing the latest {LEAD_LIST_LIMIT} leads. The CSV export includes all leads.
        </p>
      )}
    </div>
  );
}

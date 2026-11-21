"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionSteer } from "@/components/operator/session-steer";
import { Icon } from "@/components/v2/primitives/icon";
import { IconButton } from "@/components/v2/primitives/icon-button";
import { Segmented } from "@/components/v2/primitives/segmented";
import { LeadRow, LeadRowHeader } from "@/components/v2/work/lead-row";

import { applyLeadAction, type LeadActionInput } from "./actions";
import {
  FUNNEL_STATUSES,
  FUNNEL_STATUS_LABEL,
  LEAD_ACTION_LABEL,
  PAYMENT_KIND_LABEL,
  SALE_PACKAGE_LABEL,
  formatTryMinor,
  isFunnelStatus,
  leadStatusLabel,
  parseTryAmount,
  SESSION_LEAD_TABS,
  cappedNote,
  initialLeadTab,
  leadActionsFor,
  leadPaneSubtitle,
  leadPaneTitle,
  leadRowView,
  leadsExportHref,
  paginateLeads,
  showingLabel,
  type LeadAction,
  type SessionLeadCounts,
  type SessionLeadRecord,
  type SessionLeadTab,
} from "./leads-pane-model";

export type LeadsPaneProps = {
  chatId: string;
  weekId: string;
  /** e.g. "21–27 Sep 2026". */
  rangeLabel: string;
  counts: SessionLeadCounts;
  tabs: Record<SessionLeadTab, SessionLeadRecord[]>;
  /** The agent asked about borderline leads (05 session-leads/agent-question). */
  openQuestion: boolean;
  /** Viewer may accept, reject and exclude leads (steer gate). */
  canAct: boolean;
};

const TAB_LABEL: Record<SessionLeadTab, string> = {
  qualified: "Qualified",
  borderline: "Borderline",
  excluded: "Excluded",
};

/**
 * Leads work pane (05 session-leads/default, /agent-question): Qualified,
 * Borderline and Excluded tabs, Lead rows with fit ring and why tags, five
 * per page, Export CSV of the tab (uncapped), and person overrides that go
 * through lead_events.
 */
export function LeadsPane({ chatId, weekId, rangeLabel, counts, tabs, openQuestion, canAct }: LeadsPaneProps) {
  const router = useRouter();
  const steer = useSessionSteer();
  const [tab, setTab] = useState<SessionLeadTab>(() => initialLeadTab(counts, openQuestion));
  const [page, setPage] = useState(1);
  // While the agent asks about them, the borderline leads come pre-selected.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
    openQuestion && canAct ? new Set(tabs.borderline.map((lead) => lead.id)) : new Set(),
  );
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = tabs[tab];
  const current = paginateLeads(rows, page);
  const actions = canAct ? leadActionsFor(tab) : [];
  const onPage = current.rows.map((lead) => lead.id);
  const selectedOnTab = rows.filter((lead) => selected.has(lead.id)).map((lead) => lead.id);
  const allOnPage = onPage.length > 0 && onPage.every((id) => selected.has(id));
  const someOnPage = onPage.some((id) => selected.has(id));

  function changeTab(next: string) {
    const value = SESSION_LEAD_TABS.find((t) => t === next);
    if (!value) return;
    setTab(value);
    setPage(1);
    setSelected(new Set());
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of onPage) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function submit(input: Omit<LeadActionInput, "chatId">, success: (done: number) => string) {
    if (input.leadIds.length === 0) return;
    startTransition(async () => {
      try {
        const result = await applyLeadAction({ chatId, ...input });
        if (result.done > 0) toast.success(success(result.done));
        if (result.failed > 0) {
          toast.error(`${result.failed} could not be changed. They may have moved on already.`);
        }
        setSelected(new Set());
        router.refresh();
      } catch {
        toast.error("Could not update the leads");
      }
    });
  }

  function run(action: LeadAction, leadIds: string[]) {
    submit({ action, leadIds }, (done) => {
      const noun = done === 1 ? "lead" : "leads";
      const verb = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "excluded";
      return `${done} ${noun} ${verb}`;
    });
  }

  const funnelControls = canAct && tab !== "borderline";

  const note = cappedNote(counts[tab], rows.length);

  return (
    <section
      aria-label="Leads"
      data-slot="leads-pane"
      data-tab={tab}
      className="flex min-h-0 w-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
        >
          <Icon name="users" size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate type-h3 text-foreground">{leadPaneTitle(tab)}</h2>
          <p className="truncate type-small text-muted-foreground">
            {leadPaneSubtitle({ weekId, rangeLabel, counts })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="md" asChild>
            <a href={leadsExportHref(chatId, tab)} download>
              <Icon name="download" size={16} />
              Export CSV
            </a>
          </Button>
          {steer.send ? (
            <Button
              variant="outline"
              size="md"
              disabled={steer.isStreaming}
              onClick={() => steer.send?.("Search more")}
            >
              <Icon name="search" size={16} />
              Search more
            </Button>
          ) : null}
        </div>
      </header>

      <Segmented
        aria-label="Lead tabs"
        value={tab}
        onValueChange={changeTab}
        items={SESSION_LEAD_TABS.map((t) => ({
          value: t,
          label: `${TAB_LABEL[t]} ${counts[t]}`,
        }))}
      />

      {actions.length > 0 && selectedOnTab.length > 0 ? (
        <div
          data-slot="leads-selection"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2"
        >
          <span className="type-small text-foreground">{selectedOnTab.length} selected</span>
          <span className="flex-1" />
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "accept" ? "default" : "outline"}
              disabled={isPending}
              onClick={() => run(action, selectedOnTab)}
            >
              {LEAD_ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 overflow-auto rounded-xl border border-border">
        <div role="table" aria-label={leadPaneTitle(tab)} className="min-w-[640px]">
          <LeadRowHeader
            allSelected={allOnPage ? true : someOnPage ? "indeterminate" : false}
            onAllSelectedChange={togglePage}
          />
          {current.rows.length === 0 ? (
            <p className="px-3 py-8 text-center type-small text-muted-foreground">
              {emptyCopy(tab)}
            </p>
          ) : (
            current.rows.map((lead) => {
              const view = leadRowView(lead);
              return (
                <div key={lead.id} className="relative">
                  <LeadRow
                    {...view}
                    selected={selected.has(lead.id)}
                    onSelectedChange={(on) => toggle(lead.id, on)}
                    onMenu={actions.length > 0 ? () => setMenuFor(lead.id) : undefined}
                  />
                  {funnelControls ? (
                    <LeadFunnelControls
                      lead={lead}
                      disabled={isPending}
                      onSubmit={(input, success) => submit({ ...input, leadIds: [lead.id] }, () => success)}
                    />
                  ) : null}
                  {actions.length > 0 ? (
                    <DropdownMenu
                      open={menuFor === lead.id}
                      onOpenChange={(open) => setMenuFor(open ? lead.id : null)}
                    >
                      <DropdownMenuTrigger asChild>
                        <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 size-0" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {actions.map((action) => (
                          <DropdownMenuItem
                            key={action}
                            disabled={isPending}
                            onSelect={() => run(action, [lead.id])}
                          >
                            {LEAD_ACTION_LABEL[action]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="type-small text-muted-foreground">{showingLabel(tab, current, counts[tab])}</span>
          {note ? <span className="type-caption text-muted-foreground">{note}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            icon="chevron-left"
            variant="outline"
            size="sm"
            label="Previous page"
            disabled={current.page <= 1}
            onClick={() => setPage(current.page - 1)}
          />
          <span className="type-small text-foreground tabular-nums">
            Page {current.page} of {current.pageCount}
          </span>
          <IconButton
            icon="chevron-right"
            variant="outline"
            size="sm"
            label="Next page"
            disabled={current.page >= current.pageCount}
            onClick={() => setPage(current.page + 1)}
          />
        </div>
      </footer>
    </section>
  );
}

function emptyCopy(tab: SessionLeadTab): string {
  if (tab === "qualified") return "No qualified leads this week yet.";
  if (tab === "borderline") return "No borderline leads. Nothing to decide.";
  return "Nothing excluded this week.";
}

type FunnelSubmit = (input: Omit<LeadActionInput, "chatId" | "leadIds">, success: string) => void;

const FIELD =
  "h-8 rounded-md border border-border bg-background px-2 type-small text-foreground disabled:opacity-50";

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Koleva funnel controls under a lead row: the status select (Yeni ..
 * Uygun değil), the Satış form (package + amount, KDV hariç) and, on a won
 * lead, the Tahsilat list. Every change goes through `applyLeadAction`.
 */
function LeadFunnelControls({
  lead,
  disabled,
  onSubmit,
}: {
  lead: SessionLeadRecord;
  disabled: boolean;
  onSubmit: FunnelSubmit;
}) {
  const [saleOpen, setSaleOpen] = useState(false);
  const [salePackage, setSalePackage] = useState<"website" | "social">(lead.salePackage ?? "website");
  const [saleAmount, setSaleAmount] = useState(
    lead.saleAmountMinor ? formatTryMinor(lead.saleAmountMinor).replace(/ TL$/, "") : "",
  );
  const kinds = lead.paymentKinds ?? [];
  const [kind, setKind] = useState(kinds[0] ?? "deposit");
  const [payAmount, setPayAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(localToday);

  const label = leadStatusLabel(lead);
  const saleMinor = parseTryAmount(saleAmount);
  const payMinor = parseTryAmount(payAmount);
  const won = lead.status === "won";

  function move(next: string) {
    if (!isFunnelStatus(next) || next === lead.status) return;
    if (next === "won") {
      setSaleOpen(true);
      return;
    }
    setSaleOpen(false);
    const leavingSale = won && (next === "unqualified" || next === "rejected");
    if (leavingSale && !window.confirm("Bu satış geri alınsın mı? Paket ve tutar kayıtlı kalır.")) return;
    onSubmit(
      { action: "move", toStatus: next, ...(leavingSale ? { reopen: true } : {}) },
      `Durum: ${FUNNEL_STATUS_LABEL[next]}`,
    );
  }

  return (
    <div data-slot="lead-funnel" className="flex flex-col gap-2 border-b border-border px-3 pb-3 pl-12">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Status of ${lead.name}`}
          className={FIELD}
          disabled={disabled}
          value={saleOpen ? "won" : isFunnelStatus(lead.status) ? lead.status : ""}
          onChange={(event) => move(event.target.value)}
        >
          {isFunnelStatus(lead.status) ? null : (
            <option value="" disabled>
              —
            </option>
          )}
          {FUNNEL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {FUNNEL_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        {label && label !== FUNNEL_STATUS_LABEL[lead.status as keyof typeof FUNNEL_STATUS_LABEL] ? (
          <span className="type-small text-muted-foreground">{label}</span>
        ) : null}
      </div>

      {saleOpen ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (saleMinor === null) return;
            onSubmit(
              { action: "move", toStatus: "won", salePackage, saleAmountMinor: saleMinor },
              `Satış: ${SALE_PACKAGE_LABEL[salePackage]}, ${formatTryMinor(saleMinor)}`,
            );
            setSaleOpen(false);
          }}
        >
          <select
            aria-label="Paket"
            className={FIELD}
            value={salePackage}
            onChange={(event) => setSalePackage(event.target.value === "social" ? "social" : "website")}
          >
            <option value="website">{SALE_PACKAGE_LABEL.website}</option>
            <option value="social">{SALE_PACKAGE_LABEL.social}</option>
          </select>
          <input
            aria-label="Tutar (KDV hariç)"
            placeholder="Tutar (KDV hariç), örn. 80.000"
            inputMode="decimal"
            className={`${FIELD} w-48`}
            value={saleAmount}
            onChange={(event) => setSaleAmount(event.target.value)}
          />
          <span className="type-caption text-muted-foreground">TL, KDV hariç</span>
          <Button type="submit" size="sm" disabled={disabled || saleMinor === null}>
            Satışı kaydet
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSaleOpen(false)}>
            Vazgeç
          </Button>
        </form>
      ) : null}

      {won ? (
        <div data-slot="lead-payments" className="flex flex-col gap-1">
          <span className="type-caption text-muted-foreground">Tahsilat</span>
          {(lead.payments ?? []).map((payment) => (
            <div key={payment.id} className="flex items-center gap-2 type-small text-foreground">
              <span className="w-28">{PAYMENT_KIND_LABEL[payment.kind]}</span>
              <span className="w-32 tabular-nums">{formatTryMinor(payment.amountMinor)}</span>
              <span className="tabular-nums text-muted-foreground">{payment.receivedOn}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onSubmit({ action: "payment_remove", paymentId: payment.id }, "Tahsilat silindi")
                }
              >
                Sil
              </Button>
            </div>
          ))}
          {kinds.length > 0 ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (payMinor === null || !receivedOn) return;
                onSubmit(
                  { action: "payment_add", kind, amountMinor: payMinor, receivedOn },
                  `Tahsilat kaydedildi: ${formatTryMinor(payMinor)}`,
                );
                setPayAmount("");
              }}
            >
              <select
                aria-label="Ödeme türü"
                className={FIELD}
                value={kind}
                onChange={(event) => setKind(kinds.find((k) => k === event.target.value) ?? kind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {PAYMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Tahsil edilen tutar (KDV hariç)"
                placeholder="Tutar (KDV hariç)"
                inputMode="decimal"
                className={`${FIELD} w-40`}
                value={payAmount}
                onChange={(event) => setPayAmount(event.target.value)}
              />
              <input
                type="date"
                aria-label="Tahsil tarihi"
                className={FIELD}
                max={localToday()}
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={disabled || payMinor === null || !receivedOn}>
                Tahsilat ekle
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

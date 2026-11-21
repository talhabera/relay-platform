"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createAdMetaMapping,
  deleteAdMetaMapping,
  updateAdMetaMapping,
  type AdMetaMappingResult,
} from "@/app/(dashboard)/settings/companies/ad-meta-mapping-actions";

/** One mapping row as the client may hold it. */
export type AdMetaMappingRow = {
  id: string;
  sourceId: string;
  code: string;
  campaignName: string;
};

type Draft = { sourceId: string; code: string; campaignName: string };
type FieldErrors = Partial<Record<keyof Draft, string>>;

const EMPTY_DRAFT: Draft = { sourceId: "", code: "", campaignName: "" };

function MappingFields({
  idPrefix,
  draft,
  errors,
  onChange,
}: {
  idPrefix: string;
  draft: Draft;
  errors: FieldErrors;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const fields: Array<{
    key: keyof Draft;
    label: string;
    placeholder: string;
  }> = [
    { key: "sourceId", label: "Source ID", placeholder: "120207123456789" },
    { key: "code", label: "Kod", placeholder: "MWEB1" },
    { key: "campaignName", label: "Kampanya adı", placeholder: "Web sitesi" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          <Input
            id={`${idPrefix}-${field.key}`}
            value={draft[field.key]}
            placeholder={field.placeholder}
            aria-invalid={Boolean(errors[field.key])}
            onChange={(e) => onChange({ [field.key]: e.target.value })}
          />
          {errors[field.key] && (
            <p className="text-xs text-destructive">{errors[field.key]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CompanyAdMetaMappings({
  companyId,
  mappings,
}: {
  companyId: string;
  mappings: AdMetaMappingRow[];
}) {
  const router = useRouter();
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [newErrors, setNewErrors] = useState<FieldErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    action: () => Promise<AdMetaMappingResult>,
    onFieldErrors: (errors: FieldErrors) => void,
    successMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        onFieldErrors(result.fieldErrors);
        if (result.error) toast.error(result.error);
        return false;
      }
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch {
      toast.error("İşlem tamamlanamadı");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    const ok = await run(
      () => createAdMetaMapping(companyId, newDraft),
      setNewErrors,
      "Eşleme eklendi",
    );
    if (ok) {
      setNewDraft(EMPTY_DRAFT);
      setNewErrors({});
    }
  }

  async function onUpdate(id: string) {
    const ok = await run(
      () => updateAdMetaMapping(companyId, id, editDraft),
      setEditErrors,
      "Eşleme güncellendi",
    );
    if (ok) setEditingId(null);
  }

  async function onDelete(id: string) {
    const ok = await run(
      () => deleteAdMetaMapping(companyId, id),
      () => {},
      "Eşleme silindi",
    );
    if (ok) setConfirmingId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta reklam eşlemeleri</CardTitle>
        <CardDescription>
          Her Meta reklamının source_id değerini sabit koduna bağlayın. Yeni
          bir reklam için buraya satır eklemek yeterlidir, dağıtım gerekmez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {mappings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Henüz eşleme yok.
          </p>
        ) : (
          <ul className="divide-y">
            {mappings.map((mapping) =>
              editingId === mapping.id ? (
                <li key={mapping.id} className="space-y-3 py-4">
                  <MappingFields
                    idPrefix={`edit-${mapping.id}`}
                    draft={editDraft}
                    errors={editErrors}
                    onChange={(patch) =>
                      setEditDraft((d) => ({ ...d, ...patch }))
                    }
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      Vazgeç
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => onUpdate(mapping.id)}
                    >
                      {busy && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Kaydet
                    </Button>
                  </div>
                </li>
              ) : (
                <li
                  key={mapping.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {mapping.campaignName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {mapping.sourceId} · {mapping.code}
                    </p>
                  </div>
                  {confirmingId === mapping.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Silinsin mi?
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmingId(null)}
                      >
                        Vazgeç
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => onDelete(mapping.id)}
                      >
                        {busy && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Sil
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${mapping.campaignName} eşlemesini düzenle`}
                        onClick={() => {
                          setEditingId(mapping.id);
                          setEditDraft({
                            sourceId: mapping.sourceId,
                            code: mapping.code,
                            campaignName: mapping.campaignName,
                          });
                          setEditErrors({});
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${mapping.campaignName} eşlemesini sil`}
                        onClick={() => setConfirmingId(mapping.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        <div className="space-y-3 border-t pt-5">
          <p className="text-sm font-medium">Yeni eşleme</p>
          <MappingFields
            idPrefix="new-mapping"
            draft={newDraft}
            errors={newErrors}
            onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))}
          />
          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={onAdd}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ekle
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

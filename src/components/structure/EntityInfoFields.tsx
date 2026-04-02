import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityNode } from "@/hooks/useStructureData";

/** Format ABN as XX XXX XXX XXX (11 digits) */
export function formatAbn(abn: string): string {
  const digits = abn.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return abn; // return as-is if not standard length
}

/** Format ACN as XXX XXX XXX (9 digits) */
export function formatAcn(acn: string): string {
  const digits = acn.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return acn;
}

function maskTfn(tfn: string): string {
  if (tfn.length <= 3) return "•••";
  return "•••" + " " + "•••" + " " + tfn.slice(-3);
}

interface Props {
  entity: EntityNode;
}

export default function EntityInfoFields({ entity }: Props) {
  const [showTfn, setShowTfn] = useState(false);

  const fields: { label: string; value: React.ReactNode }[] = [];

  if (entity.tfn) {
    fields.push({
      label: "TFN",
      value: (
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs">
            {showTfn ? entity.tfn : maskTfn(entity.tfn)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setShowTfn(!showTfn)}
          >
            {showTfn ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </div>
      ),
    });
  }

  if (entity.state) {
    fields.push({ label: "State", value: <span className="text-xs">{entity.state}</span> });
  }

  if (entity.client_code) {
    fields.push({ label: "Client Code", value: <span className="text-xs font-mono">{entity.client_code}</span> });
  }

  if (entity.account_manager) {
    fields.push({ label: "Account Manager", value: <span className="text-xs">{entity.account_manager}</span> });
  }

  if (entity.gst_registered !== undefined) {
    fields.push({
      label: "GST Registered",
      value: <span className="text-xs">{entity.gst_registered ? "Yes" : "No"}</span>,
    });
  }

  if (entity.abn) {
    fields.push({ label: "ABN", value: <span className="text-xs font-mono">{formatAbn(entity.abn)}</span> });
  }

  if (entity.acn) {
    fields.push({ label: "ACN", value: <span className="text-xs font-mono">{formatAcn(entity.acn)}</span> });
  }

  if (fields.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md border p-3 bg-muted/30">
      {fields.map((f) => (
        <div key={f.label} className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">{f.label}</p>
          {f.value}
        </div>
      ))}
    </div>
  );
}

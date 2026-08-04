import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

type Preview = {
  firm_name: string | null;
  member_count: number;
  has_subscription: boolean;
  subscription_status: string | null;
};

async function extractError(error: unknown, fallback: string): Promise<string> {
  const anyErr = error as { context?: { json?: () => Promise<unknown> }; message?: string };
  try {
    const body = (await anyErr?.context?.json?.()) as { error?: string } | undefined;
    if (body?.error) return body.error;
  } catch {
    // ignore
  }
  return anyErr?.message || fallback;
}

export default function DangerZoneSettings() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmText("");
      setAcknowledged(false);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirmation: "DELETE", dry_run: true },
      });
      if (cancelled) return;
      if (error) {
        setError(await extractError(error, "Could not load account details."));
        return;
      }
      setPreview(data as Preview);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const canSubmit = confirmText === "DELETE" && acknowledged && !submitting;

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirmation: confirmText, password: password || undefined },
      });
      if (error) throw error;
      if ((data as { partial?: boolean; message?: string })?.partial) {
        toast({
          title: "Account deleted",
          description: (data as { message?: string }).message,
        });
      }
      await signOut().catch(() => {});
      window.location.replace("/login?account_deleted=1");
    } catch (err) {
      setError(await extractError(err, "Account deletion failed. Please try again."));
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" /> Danger zone
        </CardTitle>
        <CardDescription>
          Permanently delete this firm account and every record it contains. Only the firm owner can do this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>This action is permanent and cannot be undone.</li>
          <li>All personal data, firm settings, structures, imports and history are removed.</li>
          <li>Everyone in the firm loses access immediately and is signed out.</li>
          <li>Any active subscription or trial is cancelled before deletion.</li>
        </ul>
        <Button variant="destructive" onClick={() => setOpen(true)} className="gap-2">
          <Trash2 className="h-4 w-4" /> Delete account
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete account permanently?</DialogTitle>
            <DialogDescription>
              {preview?.firm_name
                ? `${preview.firm_name} and all of its data will be erased.`
                : "Your firm and all of its data will be erased."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This cannot be undone</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <p>
                  {preview
                    ? `${preview.member_count} user${preview.member_count === 1 ? "" : "s"} will lose access immediately.`
                    : "All users will lose access immediately."}
                </p>
                {preview?.has_subscription && (
                  <p>
                    Your {preview.subscription_status === "trialing" ? "trial" : "subscription"} will be cancelled
                    with our payment provider before the data is removed.
                  </p>
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="delete-password">Confirm your password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your account password"
              />
              <p className="text-xs text-muted-foreground">
                Enter your account password to confirm this deletion.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
              <Input
                id="delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="delete-ack"
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
              />
              <Label htmlFor="delete-ack" className="text-sm font-normal leading-snug">
                I understand this permanently deletes my account, all firm data and cancels billing.
              </Label>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!canSubmit} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {submitting ? "Deleting…" : "Delete account permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

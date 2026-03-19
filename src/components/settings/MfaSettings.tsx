import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMfa } from "@/hooks/useMfa";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Smartphone, Mail, Loader2, Check, ArrowRight } from "lucide-react";

type ChangeStep = "idle" | "totp-enroll" | "totp-verify" | "email-send" | "email-verify";

export default function MfaSettings() {
  const { user } = useAuth();
  const { method: currentMethod, status: mfaStatus, loading: mfaLoading, refetch } = useMfa();
  const { toast } = useToast();

  const [step, setStep] = useState<ChangeStep>("idle");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");

  function reset() {
    setStep("idle");
    setCode("");
    setFactorId("");
    setQrCode("");
    setTotpSecret("");
  }

  // ── Switch to TOTP ──────────────────────────────────────────
  async function startSwitchToTotp() {
    setSubmitting(true);
    try {
      // Unenroll any existing TOTP factors first to avoid name conflicts
      const { data: existingFactors } = await supabase.auth.mfa.listFactors();
      for (const f of existingFactors?.totp ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      setStep("totp-verify");
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmTotp() {
    setSubmitting(true);
    try {
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      await (supabase as any)
        .from("mfa_settings")
        .upsert({ user_id: user!.id, method: "totp" }, { onConflict: "user_id" });

      toast({ title: "MFA Updated", description: "Switched to Authenticator App." });
      reset();
      refetch();
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Switch to Email ─────────────────────────────────────────
  async function startSwitchToEmail() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mfa-email", {
        body: { action: "send" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStep("email-verify");
      toast({ title: "Code sent", description: `Verification code sent to ${user?.email}` });
    } catch (err: any) {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEmail() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mfa-email", {
        body: { action: "verify", code },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Unenroll any existing TOTP factors
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.totp ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      await (supabase as any)
        .from("mfa_settings")
        .upsert({ user_id: user!.id, method: "email" }, { onConflict: "user_id" });

      toast({ title: "MFA Updated", description: "Switched to Email Verification." });
      reset();
      refetch();
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  if (mfaLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading MFA settings…
        </CardContent>
      </Card>
    );
  }

  const methodLabel = currentMethod === "totp" ? "Authenticator App" : currentMethod === "email" ? "Email" : "Not set up";
  const MethodIcon = currentMethod === "totp" ? Smartphone : Mail;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-primary" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Manage your MFA method. Only you can change your own security settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current method display */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <MethodIcon className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Current Method</p>
              <p className="text-xs text-muted-foreground">{methodLabel}</p>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Check className="h-3 w-3" /> Active
          </Badge>
        </div>

        {/* Switch options (only show when idle) */}
        {step === "idle" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Switch to:</p>
            {currentMethod !== "totp" && (
              <Button
                variant="outline"
                className="w-full justify-between h-14"
                onClick={startSwitchToTotp}
                disabled={submitting}
              >
                <span className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-primary" />
                  <span className="text-left">
                    <span className="block text-sm font-medium">Authenticator App</span>
                    <span className="block text-xs text-muted-foreground">Google Authenticator, Authy, etc.</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            {currentMethod !== "email" && (
              <Button
                variant="outline"
                className="w-full justify-between h-14"
                onClick={startSwitchToEmail}
                disabled={submitting}
              >
                <span className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-primary" />
                  <span className="text-left">
                    <span className="block text-sm font-medium">Email Verification</span>
                    <span className="block text-xs text-muted-foreground">Code sent to {user?.email}</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            {submitting && (
              <div className="flex justify-center pt-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {/* TOTP verification step */}
        {step === "totp-verify" && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-sm font-medium">Scan this QR code with your authenticator app:</p>
            <div className="flex justify-center">
              <img src={qrCode} alt="MFA QR Code" className="w-40 h-40 rounded-lg" />
            </div>
            <details className="text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer">
                Can't scan? Enter key manually
              </summary>
              <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">{totpSecret}</code>
            </details>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="text-center text-xl tracking-[0.3em] font-mono"
              maxLength={6}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="flex-1">Cancel</Button>
              <Button onClick={confirmTotp} disabled={code.length !== 6 || submitting} className="flex-1">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </Button>
            </div>
          </div>
        )}

        {/* Email verification step */}
        {step === "email-verify" && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-sm font-medium">
              Enter the 6-digit code sent to <span className="text-primary">{user?.email}</span>
            </p>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="text-center text-xl tracking-[0.3em] font-mono"
              maxLength={6}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="flex-1">Cancel</Button>
              <Button variant="ghost" onClick={startSwitchToEmail} disabled={submitting} className="flex-1">
                Resend
              </Button>
              <Button onClick={confirmEmail} disabled={code.length !== 6 || submitting} className="flex-1">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

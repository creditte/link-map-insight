import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Smartphone, Mail, Loader2, ArrowLeft } from "lucide-react";

type Step = "choose" | "totp-scan" | "totp-verify" | "email-verify";

export default function MfaSetup() {
  const { user, bootStatus } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("choose");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (bootStatus === "booting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bootStatus === "unauthenticated" || !user) {
    return <Navigate to="/login" replace />;
  }

  // ── TOTP enrollment ─────────────────────────────────────────────
  async function startTotp() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      setStep("totp-scan");
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyTotp() {
    setSubmitting(true);
    try {
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      // Save preference
      await (supabase as any)
        .from("mfa_settings")
        .upsert({ user_id: user.id, method: "totp" }, { onConflict: "user_id" });

      toast({ title: "MFA Enabled", description: "Authenticator app is now set up." });
      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Email OTP enrollment ────────────────────────────────────────
  async function startEmail() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mfa-email", {
        body: { action: "send" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStep("email-verify");
      toast({ title: "Code sent", description: `Verification code sent to ${user.email}` });
    } catch (err: any) {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyEmail() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mfa-email", {
        body: { action: "verify", code },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Save preference
      await (supabase as any)
        .from("mfa_settings")
        .upsert({ user_id: user.id, method: "email" }, { onConflict: "user_id" });

      toast({ title: "MFA Enabled", description: "Email verification is now set up." });
      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  function goBack() {
    setStep("choose");
    setCode("");
    setQrCode("");
    setFactorId("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-2">
          <Shield className="h-10 w-10 mx-auto mb-2 text-primary" />
          <CardTitle className="text-xl font-bold">Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>Add an extra layer of security to your account</CardDescription>
        </CardHeader>
        <CardContent>
          {/* ── Choose method ───────────────────────────────── */}
          {step === "choose" && (
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full h-16 justify-start gap-4"
                onClick={startTotp}
                disabled={submitting}
              >
                <Smartphone className="h-6 w-6 shrink-0 text-primary" />
                <div className="text-left">
                  <p className="font-semibold">Authenticator App</p>
                  <p className="text-xs text-muted-foreground">Google Authenticator, Authy, etc.</p>
                </div>
              </Button>
              <Button
                variant="outline"
                className="w-full h-16 justify-start gap-4"
                onClick={startEmail}
                disabled={submitting}
              >
                <Mail className="h-6 w-6 shrink-0 text-primary" />
                <div className="text-left">
                  <p className="font-semibold">Email Verification</p>
                  <p className="text-xs text-muted-foreground">Receive a code at {user.email}</p>
                </div>
              </Button>
              {submitting && (
                <div className="flex justify-center pt-2">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}

          {/* ── TOTP: Scan QR ───────────────────────────────── */}
          {step === "totp-scan" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your authenticator app:
              </p>
              <div className="flex justify-center">
                <img src={qrCode} alt="MFA QR Code" className="w-48 h-48 rounded-lg" />
              </div>
              <details className="text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Can't scan? Enter key manually
                </summary>
                <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
                  {totpSecret}
                </code>
              </details>
              <p className="text-sm text-muted-foreground">Enter the 6-digit code from your app:</p>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.3em] font-mono"
                maxLength={6}
                autoFocus
              />
              <Button
                onClick={verifyTotp}
                className="w-full h-11 font-semibold"
                disabled={code.length !== 6 || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…
                  </>
                ) : (
                  "Verify & Enable"
                )}
              </Button>
              <Button variant="ghost" onClick={goBack} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
            </div>
          )}

          {/* ── Email OTP verify ────────────────────────────── */}
          {step === "email-verify" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code sent to{" "}
                <span className="font-medium text-foreground">{user.email}</span>
              </p>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.3em] font-mono"
                maxLength={6}
                autoFocus
              />
              <Button
                onClick={verifyEmail}
                className="w-full h-11 font-semibold"
                disabled={code.length !== 6 || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…
                  </>
                ) : (
                  "Verify & Enable"
                )}
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={goBack} className="flex-1">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button variant="ghost" onClick={startEmail} disabled={submitting} className="flex-1">
                  Resend Code
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

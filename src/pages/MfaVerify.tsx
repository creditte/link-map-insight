import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, Smartphone, Mail } from "lucide-react";

export default function MfaVerify() {
  const { user, bootStatus, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preferredMethod, setPreferredMethod] = useState<"totp" | "email" | null>(null);
  const [activeMethod, setActiveMethod] = useState<"totp" | "email" | null>(null);
  const [hasTotpFactor, setHasTotpFactor] = useState(false);
  const [loading, setLoading] = useState(true);
  const emailSentForSession = useRef(false);
  const autoSubmitTriggered = useRef(false);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !user) return;
    if (preferredMethod) return;
    detectMethod();
  }, [bootStatus, user?.id]);

  const handleVerify = activeMethod === "totp" ? verifyTotp : verifyEmail;

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !submitting && !autoSubmitTriggered.current && !loading) {
      autoSubmitTriggered.current = true;
      handleVerify();
    }
    if (code.length < 6) {
      autoSubmitTriggered.current = false;
    }
  }, [code, submitting, loading, handleVerify]);

  async function detectMethod() {
    try {
      // Check TOTP factors
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.find((f: any) => f.status === "verified");
      setHasTotpFactor(!!totpFactor);

      // Check mfa_settings preference
      const { data: settings } = await (supabase as any)
        .from("mfa_settings")
        .select("method")
        .eq("user_id", user!.id)
        .maybeSingle();

      const pref = settings?.method === "totp" && totpFactor ? "totp" : settings?.method === "email" ? "email" : totpFactor ? "totp" : "email";
      setPreferredMethod(pref as "totp" | "email");
      setActiveMethod(pref as "totp" | "email");

      // Auto-send email code if email is the active method
      if (pref === "email" && !emailSentForSession.current) {
        emailSentForSession.current = true;
        await sendEmailCode();
      }
    } catch (err) {
      console.error("[MfaVerify] detectMethod error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function sendEmailCode() {
    try {
      const { data, error } = await supabase.functions.invoke("mfa-email", {
        body: { action: "send" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Code sent", description: `Verification code sent to ${user?.email}` });
    } catch (err: any) {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    }
  }

  function switchToEmail() {
    setCode("");
    autoSubmitTriggered.current = false;
    setActiveMethod("email");
    if (!emailSentForSession.current) {
      emailSentForSession.current = true;
      sendEmailCode();
    } else {
      toast({ title: "Use existing code", description: "Check your email for the code already sent, or click Resend." });
    }
  }

  function switchToTotp() {
    setCode("");
    autoSubmitTriggered.current = false;
    setActiveMethod("totp");
  }

  async function verifyTotp() {
    setSubmitting(true);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.find((f: any) => f.status === "verified");
      if (!totpFactor) throw new Error("No authenticator found");

      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "Invalid code", description: err.message, variant: "destructive" });
      setCode("");
      autoSubmitTriggered.current = false;
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
      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "Invalid code", description: err.message, variant: "destructive" });
      setCode("");
      autoSubmitTriggered.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm border-border/50 shadow-lg">
        <CardHeader className="text-center pb-2">
          <Shield className="h-8 w-8 mx-auto mb-2 text-primary" />
          <CardTitle className="text-xl font-bold">Two-Factor Verification</CardTitle>
          <CardDescription>
            {activeMethod === "totp"
              ? "Enter the code from your authenticator app"
              : `Enter the code sent to ${user.email}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="text-center text-2xl tracking-[0.3em] font-mono"
            maxLength={6}
            autoFocus
          />
          {submitting && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Method-specific actions */}
          {activeMethod === "email" && (
            <Button variant="ghost" onClick={sendEmailCode} className="w-full text-sm">
              Resend Code
            </Button>
          )}

          {/* Switch method options */}
          <div className="border-t pt-3 space-y-1.5">
            {activeMethod === "totp" && (
              <Button
                variant="ghost"
                onClick={switchToEmail}
                className="w-full text-sm gap-2 text-muted-foreground hover:text-foreground"
              >
                <Mail className="h-4 w-4" />
                Can't access authenticator? Use email instead
              </Button>
            )}
            {activeMethod === "email" && hasTotpFactor && (
              <Button
                variant="ghost"
                onClick={switchToTotp}
                className="w-full text-sm gap-2 text-muted-foreground hover:text-foreground"
              >
                <Smartphone className="h-4 w-4" />
                Use authenticator app instead
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            onClick={signOut}
            className="w-full text-sm text-muted-foreground"
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2 } from "lucide-react";

export default function MfaVerify() {
  const { user, bootStatus, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<"totp" | "email" | null>(null);
  const [loading, setLoading] = useState(true);
  const initialSentRef = useRef(false);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !user) return;
    if (method) return; // Already detected, don't re-run
    detectMethod();
  }, [bootStatus, user?.id]);

  async function detectMethod() {
    try {
      // Check TOTP factors
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.find((f: any) => f.status === "verified");

      if (totpFactor) {
        setMethod("totp");
        setLoading(false);
        return;
      }

      // Check email method
      const { data: settings } = await (supabase as any)
        .from("mfa_settings")
        .select("method")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (settings?.method === "email") {
        setMethod("email");
        if (!initialSentRef.current) {
          initialSentRef.current = true;
          await sendEmailCode();
        }
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
    } finally {
      setSubmitting(false);
    }
  }

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleVerify = method === "totp" ? verifyTotp : verifyEmail;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm border-border/50 shadow-lg">
        <CardHeader className="text-center pb-2">
          <Shield className="h-8 w-8 mx-auto mb-2 text-primary" />
          <CardTitle className="text-xl font-bold">Two-Factor Verification</CardTitle>
          <CardDescription>
            {method === "totp"
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
          <Button
            onClick={handleVerify}
            className="w-full h-11 font-semibold"
            disabled={code.length !== 6 || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…
              </>
            ) : (
              "Verify"
            )}
          </Button>
          {method === "email" && (
            <Button variant="ghost" onClick={sendEmailCode} className="w-full text-sm">
              Resend Code
            </Button>
          )}
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

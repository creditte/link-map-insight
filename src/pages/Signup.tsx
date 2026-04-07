import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const TRUST_POINTS = [
  "Built for accounting firms and advisors",
  "Clear professional workspace setup",
  "Simple secure cloud access",
];

export default function Signup() {
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firmName, setFirmName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Verification state
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [verified, setVerified] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const navigate = useNavigate();
  const autoSubmitTriggered = useRef(false);

  // Read plan/billing from URL and store in localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    const billing = params.get("billing");
    localStorage.setItem("selectedPlan", plan && ["starter", "pro", "enterprise"].includes(plan) ? plan : "pro");
    localStorage.setItem("selectedBilling", billing && ["monthly", "annual"].includes(billing) ? billing : "monthly");
  }, []);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (verifyCode.length === 6 && !verifying && !autoSubmitTriggered.current && needsVerification) {
      autoSubmitTriggered.current = true;
      handleVerify();
    }
    if (verifyCode.length < 6) {
      autoSubmitTriggered.current = false;
    }
  }, [verifyCode, verifying, needsVerification]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Minimum 6 characters.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("self-signup", {
        body: { fullName, email, password, firmName },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || "Signup failed";
        if (msg.includes("already exists")) {
          toast({ title: "Account exists", description: "An account with this email already exists. Please log in instead.", variant: "destructive" });
        } else {
          throw new Error(msg);
        }
        return;
      }

      // Show verification code screen
      setNeedsVerification(true);
    } catch (err: any) {
      toast({ title: "Signup failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (verifyCode.length !== 6) return;
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signup", {
        body: { email, code: verifyCode },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || "Verification failed";
        toast({ title: "Verification failed", description: msg, variant: "destructive" });
        setVerifyCode("");
        autoSubmitTriggered.current = false;
        return;
      }

      setVerified(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setVerifyCode("");
      autoSubmitTriggered.current = false;
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signup", {
        body: { email, action: "resend" },
      });
      if (error || data?.error) {
        toast({ title: "Resend failed", description: data?.error || error?.message, variant: "destructive" });
        return;
      }
      toast({ title: "Code sent", description: "A new verification code has been sent to your email." });
      setVerifyCode("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  // ── Verified success → sign in and go to dashboard ──
  if (verified) {
    const handleStartTrial = async () => {
      setStartingCheckout(true);
      try {
        // Sign in the user — subscription already created during signup
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        navigate("/");
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        navigate("/login");
      } finally {
        setStartingCheckout(false);
      }
    };

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Email verified!</h1>
          <p className="mt-3 text-muted-foreground">
            Your 7-day free trial is ready. Let's get started!
          </p>
          <Button
            className="mt-8 w-full h-11 font-semibold"
            onClick={handleStartTrial}
            disabled={startingCheckout}
          >
            {startingCheckout ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in…</>
            ) : (
              "Get Started"
            )}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            7-day free trial · Then A$149/month
          </p>
        </div>
      </div>
    );
  }

  // ── Verification code entry screen ──
  if (needsVerification) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Verify your email</h1>
          <p className="mt-3 text-muted-foreground">
            We've sent a 6-digit code to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>

          <div className="mt-8 flex justify-center">
            <InputOTP
              maxLength={6}
              value={verifyCode}
              onChange={setVerifyCode}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            className="mt-6 w-full h-11 font-semibold"
            disabled={verifyCode.length !== 6 || verifying}
            onClick={handleVerify}
          >
            {verifying ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
            ) : (
              "Verify & Continue"
            )}
          </Button>

          <p className="mt-4 text-sm text-muted-foreground">
            Didn't receive the code?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline disabled:opacity-50"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? "Sending..." : "Resend Code"}
            </button>
          </p>

          <p className="mt-6 text-xs text-muted-foreground">
            Code expires in 10 minutes. Check your spam folder if you don't see it.
          </p>
        </div>
      </div>
    );
  }

  // ── Signup form ──
  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground flex-col justify-center px-16 xl:px-24">
        <h1 className="text-4xl xl:text-5xl font-bold tracking-tight leading-tight">
          Start your 7-day<br />free trial
        </h1>
        <p className="mt-4 text-lg opacity-90 max-w-md">
          Create your strukcha workspace and start in minutes.
        </p>
        <ul className="mt-10 space-y-4">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 opacity-80" />
              <span className="text-base opacity-90">{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile-only header */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Start your 7-day free trial</h1>
            <p className="mt-2 text-muted-foreground">
              Create your strukcha workspace and start in minutes.
            </p>
          </div>

          <Card className="border-border/50 shadow-lg">
            <CardContent className="p-6 sm:p-8">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@yourfirm.com.au"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="firmName">Firm name</Label>
                  <Input
                    id="firmName"
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="Smith & Associates"
                    required
                  />
                </div>

                <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating workspace...</>
                  ) : (
                    "Start Free Trial"
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  7-day free trial · Then A$149/month · No credit card required
                </p>
              </form>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

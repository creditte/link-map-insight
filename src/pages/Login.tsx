import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import XeroLogo from "@/components/XeroLogo";

export default function Login() {
  const { user, bootStatus } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [xeroLoginLoading, setXeroLoginLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("xero_signup");
    if (mode === "exists") {
      const em = params.get("email");
      toast({
        title: "Account already exists",
        description: em
          ? `Log in with ${em}, then connect Xero from your dashboard if needed.`
          : "Log in with your email and password.",
        variant: "destructive",
      });
    } else if (mode === "done") {
      toast({
        title: "Almost there",
        description:
          "We could not open an automatic login link. Use “Forgot password?” to set a password for this email.",
      });
    }
    if (mode) {
      params.delete("xero_signup");
      params.delete("email");
      const q = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}`,
      );
    }
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("account_deleted") !== "1") return;
    toast({
      title: "Account deleted",
      description:
        "Your account and all firm data have been permanently deleted. Any active subscription or trial was cancelled.",
    });
    params.delete("account_deleted");
    const q = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("xero_login");
    if (!mode) return;


    if (mode === "no_account") {
      toast({
        title: "No Strukcha account for this Xero email",
        description:
          "Start a free trial and use “Continue with Xero” on the sign-up page first.",
        variant: "destructive",
      });
    } else if (mode === "not_xero_signup") {
      toast({
        title: "Sign in with email and password",
        description:
          "This workspace was not created via Xero sign-up. Use your work email and password, or reset your password below.",
        variant: "destructive",
      });
    } else if (mode === "magiclink_failed") {
      toast({
        title: "Almost there",
        description:
          "We could not open an automatic login link. Use “Forgot password?” to set a password for this email.",
      });
    } else if (mode === "error") {
      const reason = params.get("reason") || "unknown";
      const messages: Record<string, string> = {
        invalid_csrf: "Session expired. Please try again.",
        expired_csrf: "Session expired. Please try again.",
        token_exchange_failed: "Could not complete Xero authorization.",
        invalid_id_token: "Could not verify identity from Xero.",
        no_email: "Xero did not return an email for this account.",
        no_id_token: "Xero did not return an identity token.",
        no_profile: "Your account is missing profile data. Contact support.",
        user_lookup_failed:
          "Could not load your account. Try again or use email and password.",
        server_error: "Something went wrong. Please try again.",
      };
      toast({
        title: "Xero sign-in failed",
        description: messages[reason] || `Error: ${reason.replace(/_/g, " ")}`,
        variant: "destructive",
      });
    }

    params.delete("xero_login");
    params.delete("reason");
    params.delete("email");
    const q = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}`,
    );
  }, [toast]);

  // Redirect authenticated users
  useEffect(() => {
    if (bootStatus !== "authenticated" || !user) return;

    let cancelled = false;

    (async () => {
      // Check super admin
      const { data: superAdminRow } = await supabase
        .from("super_admins")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      if (superAdminRow) {
        navigate("/admin", { replace: true });
        return;
      }

      // Check onboarding
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_complete")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      const needsInvitePassword =
        profile?.onboarding_complete === false &&
        user.user_metadata?.signup_source !== "self_service";
      if (needsInvitePassword) {
        navigate("/setup-password", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootStatus, user, navigate]);

  if (bootStatus === "booting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } catch (err: any) {
      toast({
        title: "Sign in failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleXeroLogin = async () => {
    setXeroLoginLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "xero-login-auth",
        {
          body: { origin: window.location.origin },
        },
      );
      if (error) throw error;
      const oauthUrl = (data as { url?: string })?.url;
      if (!oauthUrl || (data as { error?: string })?.error) {
        throw new Error(
          (data as { error?: string })?.error || "Could not start Xero sign-in",
        );
      }
      // Xero blocks being rendered inside iframes (X-Frame-Options: DENY).
      // If we're inside one (e.g. Lovable preview), break out to the top window.
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = oauthUrl;
          return;
        }
      } catch {
        // Cross-origin top access blocked — fall back to a new tab.
        window.open(oauthUrl, "_blank", "noopener,noreferrer");
        return;
      }
      window.location.href = oauthUrl;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not start Xero sign-in";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setXeroLoginLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold tracking-tight">
              Strukcha
            </CardTitle>
            <CardDescription>
              Log in to access your strukcha workspace Production.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-11 font-semibold"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Logging
                    in...
                  </>
                ) : (
                  "Log In"
                )}
              </Button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                className="w-full h-11 border-0 bg-[#14B5EA] text-base font-semibold text-white hover:bg-[#14B5EA]/90 focus-visible:ring-white/40"
                disabled={xeroLoginLoading || submitting}
                onClick={handleXeroLogin}
              >
                {xeroLoginLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Redirecting to
                    Xero…
                  </>
                ) : (
                  <>
                    <XeroLogo className="h-8 w-8 shrink-0" />
                    Sign in with Xero
                  </>
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Only for accounts originally created with Xero. Others should
                use email and password.
              </p>
            </form>

            <div className="mt-5 flex items-center justify-between text-sm">
              <Link
                to="/forgot-password"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need help?{" "}
          <a href="mailto:hello@strukcha.app" className="hover:underline">
            hello@strukcha.app
          </a>
        </p>
      </div>
    </div>
  );
}

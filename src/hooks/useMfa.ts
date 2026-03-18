import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type MfaStatus = "loading" | "not-enrolled" | "needs-verification" | "verified";
export type MfaMethod = "totp" | "email" | null;

export function useMfa() {
  const { user, session, bootStatus } = useAuth();
  const [status, setStatus] = useState<MfaStatus>("loading");
  const [method, setMethod] = useState<MfaMethod>(null);
  const [loading, setLoading] = useState(true);

  const checkMfaStatus = useCallback(async () => {
    if (!user || !session || bootStatus !== "authenticated") {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 1. Check TOTP via Supabase native MFA
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.currentLevel === "aal2") {
        setStatus("verified");
        setMethod("totp");
        setLoading(false);
        return;
      }

      if (aalData?.nextLevel === "aal2") {
        // TOTP enrolled but not verified this session
        setStatus("needs-verification");
        setMethod("totp");
        setLoading(false);
        return;
      }

      // 2. Check email MFA via mfa_settings table
      const { data: settings } = await (supabase as any)
        .from("mfa_settings")
        .select("method")
        .eq("user_id", user.id)
        .maybeSingle();

      if (settings?.method === "email") {
        // Check if verified this session (non-expired verification record)
        const { data: verif } = await (supabase as any)
          .from("mfa_verifications")
          .select("id")
          .eq("user_id", user.id)
          .gt("expires_at", new Date().toISOString())
          .order("verified_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        setMethod("email");
        setStatus(verif ? "verified" : "needs-verification");
        setLoading(false);
        return;
      }

      // 3. No MFA enrolled
      setStatus("not-enrolled");
      setMethod(null);
    } catch (err) {
      console.error("[useMfa] Check failed:", err);
      setStatus("not-enrolled");
      setMethod(null);
    } finally {
      setLoading(false);
    }
  }, [user, session, bootStatus]);

  useEffect(() => {
    checkMfaStatus();
  }, [checkMfaStatus]);

  return { status, method, loading, refetch: checkMfaStatus };
}

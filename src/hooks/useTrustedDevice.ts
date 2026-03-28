import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const TRUSTED_DEVICE_KEY = "td_token";

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TRUSTED_DEVICE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string) {
  try {
    localStorage.setItem(TRUSTED_DEVICE_KEY, token);
  } catch {
    // noop
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TRUSTED_DEVICE_KEY);
  } catch {
    // noop
  }
}

export function useTrustedDevice() {
  const registerDevice = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "register" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    storeToken(data.trusted_device_token);
    return data;
  }, []);

  const validateDevice = useCallback(async (): Promise<boolean> => {
    const token = getStoredToken();
    if (!token) return false;

    try {
      const { data, error } = await supabase.functions.invoke("trusted-device", {
        body: { action: "validate", device_token: token },
      });
      if (error || data?.error) {
        clearToken();
        return false;
      }
      return data?.trusted === true;
    } catch {
      return false;
    }
  }, []);

  const revokeAllDevices = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "revoke-all" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    clearToken();
    return data;
  }, []);

  const revokeDevice = useCallback(async (deviceId: string) => {
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "revoke", device_id: deviceId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const listDevices = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "list" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data.devices as Array<{
      id: string;
      device_label: string;
      ip_address: string;
      created_at: string;
      last_used_at: string;
      expires_at: string;
    }>;
  }, []);

  return {
    registerDevice,
    validateDevice,
    revokeAllDevices,
    revokeDevice,
    listDevices,
    clearToken,
    hasStoredToken: () => !!getStoredToken(),
  };
}

import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEGACY_TRUSTED_DEVICE_KEY = "td_token";

function scopedKey(userId: string) {
  return `td_token:${userId}`;
}

export function getStoredTrustedToken(userId: string): string | null {
  try {
    const scoped = localStorage.getItem(scopedKey(userId));
    if (scoped) return scoped;
    return localStorage.getItem(LEGACY_TRUSTED_DEVICE_KEY);
  } catch {
    return null;
  }
}

export function storeTrustedToken(userId: string, token: string) {
  try {
    localStorage.setItem(scopedKey(userId), token);
    localStorage.removeItem(LEGACY_TRUSTED_DEVICE_KEY);
  } catch {
    // noop
  }
}

/** Remove stored trust token for one user (and legacy key). */
export function clearTrustedTokensForUser(userId: string) {
  try {
    localStorage.removeItem(scopedKey(userId));
    localStorage.removeItem(LEGACY_TRUSTED_DEVICE_KEY);
  } catch {
    // noop
  }
}

/** Sign-out / security reset: remove every td_token:* plus legacy key. */
export function clearAllTrustedDeviceTokens() {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === LEGACY_TRUSTED_DEVICE_KEY || k.startsWith("td_token:")) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // noop
  }
}

/**
 * Server confirms the device token is invalid/expired — safe to drop local storage.
 * Do NOT clear on network errors or 401/500; that wipes a valid trust after a flaky request.
 */
export async function validateStoredTrustedDevice(userId: string): Promise<boolean> {
  const token = getStoredTrustedToken(userId);
  if (!token) return false;

  const { data, error } = await supabase.functions.invoke("trusted-device", {
    body: { action: "validate", device_token: token },
  });

  if (error) {
    console.warn("[useTrustedDevice] validate invoke error (keeping stored token):", error.message);
    return false;
  }

  if (data?.trusted === true) {
    try {
      if (localStorage.getItem(LEGACY_TRUSTED_DEVICE_KEY) === token) {
        storeTrustedToken(userId, token);
      }
    } catch {
      // noop
    }
    return true;
  }

  if (data?.trusted === false && data?.reason === "not_found_or_expired") {
    clearTrustedTokensForUser(userId);
    return false;
  }

  if (data?.error) {
    console.warn("[useTrustedDevice] validate response error (keeping token):", data.error);
    return false;
  }

  return false;
}

export function useTrustedDevice() {
  const registerDevice = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) throw new Error("Not signed in");

    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "register" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    storeTrustedToken(user.id, data.trusted_device_token);
    return data;
  }, []);

  const validateDevice = useCallback(async (): Promise<boolean> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return false;
    return validateStoredTrustedDevice(user.id);
  }, []);

  const revokeAllDevices = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "revoke-all" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) clearTrustedTokensForUser(user.id);
    else clearAllTrustedDeviceTokens();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const device_token = user?.id ? getStoredTrustedToken(user.id) : null;
    const { data, error } = await supabase.functions.invoke("trusted-device", {
      body: { action: "list", ...(device_token ? { device_token } : {}) },
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
      is_current?: boolean;
    }>;
  }, []);

  return {
    registerDevice,
    validateDevice,
    revokeAllDevices,
    revokeDevice,
    listDevices,
    clearToken: () => {
      void supabase.auth.getUser().then(({ data: { user } }) => {
        if (user?.id) clearTrustedTokensForUser(user.id);
        else clearAllTrustedDeviceTokens();
      });
    },
    hasStoredToken: () => {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k === LEGACY_TRUSTED_DEVICE_KEY || k.startsWith("td_token:"))) {
            return !!localStorage.getItem(k);
          }
        }
        return false;
      } catch {
        return false;
      }
    },
  };
}

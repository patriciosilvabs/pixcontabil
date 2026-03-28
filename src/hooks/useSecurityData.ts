import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface SecurityMetrics {
  events_24h: number;
  open_alerts: number;
  blocked_ips: number;
  critical_alerts: number;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: string;
  ip_address: string;
  user_id: string | null;
  user_agent: string | null;
  metadata: any;
  created_at: string;
}

interface SecurityAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  source_ip: string | null;
  status: string;
  created_at: string;
}

interface IpBlock {
  id: string;
  ip_address: string;
  reason: string;
  blocked_by: string;
  blocked_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

async function callSecurityAdmin(path: string, method = "GET", body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/security-admin/${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

export function useSecurityData() {
  const { isAdmin } = useAuth();
  const [metrics, setMetrics] = useState<SecurityMetrics>({
    events_24h: 0,
    open_alerts: 0,
    blocked_ips: 0,
    critical_alerts: 0,
  });
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [ipBlocks, setIpBlocks] = useState<IpBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("alerts");

  const fetchAll = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const [m, e, a, b] = await Promise.all([
        callSecurityAdmin("metrics"),
        callSecurityAdmin("events?limit=100"),
        callSecurityAdmin("alerts?limit=100"),
        callSecurityAdmin("ip-blocks"),
      ]);
      setMetrics(m);
      setEvents(e);
      setAlerts(a);
      setIpBlocks(b);
    } catch (err) {
      console.error("Failed to fetch security data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Realtime for alerts
  useEffect(() => {
    const channel = supabase
      .channel("security-alerts-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "security_alerts" },
        () => {
          fetchAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  const resolveAlert = async (alertId: string) => {
    await callSecurityAdmin(`alerts/${alertId}/resolve`, "POST");
    await fetchAll();
  };

  const dismissAlert = async (alertId: string) => {
    await callSecurityAdmin(`alerts/${alertId}/dismiss`, "POST");
    await fetchAll();
  };

  const blockIp = async (ip_address: string, reason: string, expires_at?: string) => {
    await callSecurityAdmin("ip-blocks", "POST", { ip_address, reason, expires_at });
    await fetchAll();
  };

  const unblockIp = async (blockId: string) => {
    await callSecurityAdmin(`ip-blocks/${blockId}`, "DELETE");
    await fetchAll();
  };

  return {
    metrics,
    events,
    alerts,
    ipBlocks,
    isLoading,
    activeTab,
    setActiveTab,
    fetchAll,
    resolveAlert,
    dismissAlert,
    blockIp,
    unblockIp,
  };
}

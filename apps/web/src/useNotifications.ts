import { useEffect, useRef, useState } from 'react';
import type { Session } from './Login';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export interface Notification {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string | null;
  source_table: string;
  source_table_uuid: string;
  workflow_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function notificationKey(notification: Notification): string {
  return notification.workflow_id
    ? `${notification.workflow_id}:${notification.type}`
    : `${notification.type}:${notification.source_table}:${notification.source_table_uuid}`;
}

function uniqueNotifications(rows: Notification[]): Notification[] {
  const seen = new Set<string>();
  return rows.filter((notification) => {
    const key = notificationKey(notification);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Persisted notification feed + live push. The REST fetch on mount/reconnect is the source
 * of truth for `unreadCount` (so a missed WebSocket push while the tab was closed never
 * leaves the badge wrong); the socket just adds items live while the app is open.
 */
export function useNotifications(session: Session | null, authHeaders: () => Promise<Record<string, string>>) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [live, setLive] = useState<Notification | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    setUnreadCount(items.filter((notification) => !notification.read_at).length);
  }, [items]);

  async function refresh() {
    if (!session) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/notifications`, { headers });
    if (!res.ok) return;
    const rows: Notification[] = await res.json();
    const uniqueRows = uniqueNotifications(rows);
    setItems(uniqueRows);
    setUnreadCount(uniqueRows.filter((n) => !n.read_at).length);
  }

  async function markRead(id: string) {
    if (!session) return;
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    const headers = await authHeaders();
    await fetch(`${API}/notifications/${id}/read`, { method: 'POST', headers });
  }

  async function markAllRead() {
    if (!session) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnreadCount(0);
    const headers = await authHeaders();
    await fetch(`${API}/notifications/read-all`, { method: 'POST', headers });
  }

  useEffect(() => {
    if (!session) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  useEffect(() => {
    if (!session) return;
    closedByUs.current = false;

    function scheduleReconnect() {
      if (closedByUs.current) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    }

    async function connect() {
      const headers = await authHeaders();
      const token = headers.Authorization?.replace(/^Bearer /, '');
      if (!token || closedByUs.current) return;

      const wsUrl = `${API.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')}/ws/notifications`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (event) => {
        let msg: unknown;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (typeof msg !== 'object' || msg === null) return;
        const { type, notification } = msg as { type?: string; notification?: Notification };
        if (type === 'ready') reconnectAttempt.current = 0;
        if (type === 'notification' && notification) {
          setItems((prev) => {
            const key = notificationKey(notification);
            const existing = prev.find((item) => notificationKey(item) === key);
            const merged = existing?.read_at && !notification.read_at
              ? { ...notification, read_at: existing.read_at }
              : notification;
            return [merged, ...prev.filter((item) => notificationKey(item) !== key)];
          });
          setLive(notification);
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        // A dropped connection may have meant a missed push — resync from the persisted list.
        void refresh();
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    }

    void connect();

    return () => {
      closedByUs.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- authHeaders changes every render; keying off session?.userId keeps the socket from thrashing on unrelated re-renders (same convention as Timesheet.tsx's reload effect).
  }, [session?.userId]);

  return { items, unreadCount, live, clearLive: () => setLive(null), markRead, markAllRead, refresh };
}

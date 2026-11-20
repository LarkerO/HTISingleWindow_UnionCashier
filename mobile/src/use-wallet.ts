import { useCallback, useEffect, useRef, useState } from 'react';
import { api, message } from './api';
import { preserveTerminal } from './payment';
import type { Account, Checkout, Environment, Order, Status, Wallet } from './types';

export function useWallet(checkoutId: string | undefined) {
  const [status, setStatus] = useState<Status>();
  const [wallet, setWallet] = useState<Wallet>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [checkout, setCheckout] = useState<Checkout>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [balancePending, setBalancePending] = useState(false);
  const [revision, setRevision] = useState(0);
  const checkoutRevision = useRef(0);
  const environment = useRef<Environment>('live');
  const requestedAt = useRef(0);
  const mounted = useRef(true);

  const acceptCheckout = useCallback((data: Checkout) => {
    checkoutRevision.current++;
    setCheckout(previous => ({ ...data, order: preserveTerminal(previous?.order, data.order) }));
  }, []);
  const acceptOrder = useCallback((order: Order) => {
    checkoutRevision.current++;
    setCheckout(previous => previous ? { ...previous, order: preserveTerminal(previous.order, order) } : undefined);
  }, []);
  const readOrder = useCallback(async () => {
    const version = ++checkoutRevision.current;
    const data = await api<Checkout>('checkout/' + checkoutId);
    if (mounted.current && version === checkoutRevision.current) setCheckout(previous => ({ ...data, order: preserveTerminal(previous?.order, data.order) }));
    return data.order;
  }, [checkoutId]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const applyWallet = (value: Wallet) => {
      if (cancelled) return;
      setWallet(value);
      const pending = value.available && !value.complete && Date.now() - requestedAt.current < 12000;
      setBalancePending(pending);
      setRefreshing(pending);
    };
    async function poll() {
      try {
        const results = await Promise.all([
          api<Wallet>('player-wallet?environment=' + environment.current),
          api<Account>('account'),
          checkoutId ? readOrder() : Promise.resolve(),
        ]);
        if (cancelled) return;
        applyWallet(results[0]);
        setOrders(results[1].orders);
        setError('');
      } catch (failure) {
        if (!cancelled) {
          setError(message(failure));
          if (Date.now() - requestedAt.current >= 12000) {
            setBalancePending(false);
            setRefreshing(false);
          }
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    }
    async function load() {
      setError('');
      try {
        const currentStatus = await api<Status>('status');
        if (cancelled) return;
        setStatus(currentStatus);
        if (!currentStatus.installed || !currentStatus.user) return;
        const data = checkoutId ? await api<Checkout>('checkout/' + checkoutId) : undefined;
        if (cancelled) return;
        if (data) acceptCheckout(data);
        environment.current = data?.order.env ?? (new URLSearchParams(location.search).get('environment') === 'sandbox' ? 'sandbox' : 'live');
        requestedAt.current = Date.now();
        if (environment.current === 'live' && currentStatus.user.uuid) {
          // Balance requests only query the game plugin; this never submits a payment.
          await api('balance', {}).catch(() => undefined);
        }
        await poll();
      } catch (failure) {
        if (!cancelled) setError(message(failure));
      }
    }
    void load();
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); };
  }, [checkoutId, revision, acceptCheckout, readOrder]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    requestedAt.current = Date.now();
    try {
      if (environment.current === 'live' && status?.user?.uuid) await api('balance', {});
      const data = await api<Wallet>('player-wallet?environment=' + environment.current);
      setWallet(data);
      const pending = data.available && !data.complete;
      setBalancePending(pending);
      setRefreshing(pending);
    } catch (failure) { setError(message(failure)); setRefreshing(false); }
  };
  return { status, wallet, orders, checkout, error, refreshing, balancePending, refresh,
    acceptOrder, readOrder, retry: () => setRevision(value => value + 1) };
}

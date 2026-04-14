'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type BillingCycle = 'monthly' | 'yearly';
type Currency = 'CNY' | 'USD';

type Subscription = {
  id: number;
  name: string;
  price: number;
  currency: Currency;
  cycle: BillingCycle;
  category: string;
  nextBillingDate: string;
  note?: string;
};

type NewSubscriptionForm = Omit<Subscription, 'id'>;
type LegacySubscription = Partial<Subscription> & {
  id?: number | string;
  price?: number | string;
};

const initialSubscriptions: Subscription[] = [
  { id: 1, name: 'Spotify', price: 15, currency: 'USD', cycle: 'monthly', category: '影音', nextBillingDate: '2026-04-28', note: '' },
  { id: 2, name: 'Notion Plus', price: 96, currency: 'USD', cycle: 'yearly', category: '生产力', nextBillingDate: '2026-11-05', note: '' },
  { id: 3, name: 'iCloud+', price: 21, currency: 'CNY', cycle: 'monthly', category: '存储', nextBillingDate: '2026-04-21', note: '' },
];

const emptyForm: NewSubscriptionForm = { name: '', price: 0, currency: 'CNY', cycle: 'monthly', category: '', nextBillingDate: '', note: '' };
const STORAGE_KEY = 'subtrack.subscriptions';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const USD_TO_CNY = 7.2;
const CATEGORY_COLORS = ['#8ea3b5', '#6a88f7', '#8b6cf6', '#ec6a5f', '#4ea88d', '#f2a54a'];
const BRAND_HOSTS: Record<string, string> = {
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDaysUntilBilling(nextBillingDate: string, today: number): number {
  const nextDate = startOfDay(new Date(nextBillingDate)).getTime();
  return Math.ceil((nextDate - today) / DAY_IN_MS);
}

function getPreviousBillingDate(nextBillingDate: string, cycle: BillingCycle): Date {
  const next = new Date(nextBillingDate);
  const previous = new Date(next);
  if (cycle === 'monthly') previous.setMonth(previous.getMonth() - 1);
  if (cycle === 'yearly') previous.setFullYear(previous.getFullYear() - 1);
  return previous;
}

function getBillingProgress(nextBillingDate: string, cycle: BillingCycle, today: number): number {
  const next = startOfDay(new Date(nextBillingDate)).getTime();
  const previous = startOfDay(getPreviousBillingDate(nextBillingDate, cycle)).getTime();
  const total = Math.max(next - previous, DAY_IN_MS);
  const elapsed = today - previous;
  const rawProgress = (elapsed / total) * 100;
  return Math.min(100, Math.max(0, rawProgress));
}

function toCny(amount: number, currency: Currency): number {
  return currency === 'USD' ? amount * USD_TO_CNY : amount;
}

function normalizeSubscription(item: LegacySubscription, index: number): Subscription | null {
  if (!item || typeof item !== 'object') return null;

  const rawName = typeof item.name === 'string' ? item.name.trim() : '';
  const rawPrice =
    typeof item.price === 'number'
      ? item.price
      : typeof item.price === 'string'
        ? Number(item.price)
        : NaN;
  const rawDate = typeof item.nextBillingDate === 'string' ? item.nextBillingDate : '';
  const cycle: BillingCycle = item.cycle === 'yearly' ? 'yearly' : 'monthly';
  const currency: Currency = item.currency === 'USD' ? 'USD' : 'CNY';
  const category = typeof item.category === 'string' && item.category.trim() ? item.category.trim() : '其他';
  const note = typeof item.note === 'string' ? item.note.trim() : '';

  if (!rawName || !Number.isFinite(rawPrice) || rawPrice <= 0 || !rawDate) return null;

  const parsedId =
    typeof item.id === 'number'
      ? item.id
      : typeof item.id === 'string' && Number.isFinite(Number(item.id))
        ? Number(item.id)
        : Date.now() + index;

  return {
    id: parsedId,
    name: rawName,
    price: rawPrice,
    currency,
    cycle,
    category,
    nextBillingDate: rawDate,
    note,
  };
}

function ServiceIcon({ name }: { name: string }) {
  const [imageError, setImageError] = useState(false);
  const normalized = name.toLowerCase().trim();
  const key = normalized.replace(/[^a-z0-9]/g, '');
  const host = BRAND_HOSTS[key] ?? `${key || 'service'}.com`;
  const iconUrl = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  const avatarPalette = ['#dde7f2', '#e8def8', '#dff1ea', '#f7e3dc', '#f2ecd8', '#e3eaf0'];
  const avatarColor = avatarPalette[(name.charCodeAt(0) || 0) % avatarPalette.length];

  if (imageError) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold text-[#4f5f70]"
        style={{ backgroundColor: avatarColor }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={iconUrl}
      alt={`${name} icon`}
      className="h-6 w-6 rounded-md"
      onError={() => setImageError(true)}
    />
  );
}

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(initialSubscriptions);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<NewSubscriptionForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<'default' | 'granted' | 'denied'>('default');
  const [search, setSearch] = useState('');
  const [progressReady, setProgressReady] = useState(false);
  const [headerDate, setHeaderDate] = useState('');
  const [headerDateEn, setHeaderDateEn] = useState('');
  const [todayTimestamp, setTodayTimestamp] = useState<number | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setHasLoadedFromStorage(true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSubscriptions([]);
        return;
      }

      const restored = parsed
        .map((item, index) => normalizeSubscription(item as LegacySubscription, index))
        .filter((item): item is Subscription => item !== null);

      setSubscriptions(restored);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasLoadedFromStorage(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedFromStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
  }, [hasLoadedFromStorage, subscriptions]);

  useEffect(() => {
    if (!('Notification' in window)) return;
    setNotificationStatus(Notification.permission);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setProgressReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setIsMounted(true);
    const now = new Date();
    setTodayTimestamp(startOfDay(now).getTime());
    const dateText = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(now);
    setHeaderDate(dateText);
    const dateTextEn = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }).format(now);
    setHeaderDateEn(dateTextEn);
  }, []);

  const metrics = useMemo(() => {
    const monthlyTotal = subscriptions.reduce((total, item) => {
      const monthlyAmount = item.cycle === 'monthly' ? item.price : item.price / 12;
      return total + toCny(monthlyAmount, item.currency);
    }, 0);
    const annualForecast = subscriptions.reduce((total, item) => {
      const annualAmount = item.cycle === 'monthly' ? item.price * 12 : item.price;
      return total + toCny(annualAmount, item.currency);
    }, 0);
    return { monthlyTotal, annualForecast, activeSubs: subscriptions.length };
  }, [subscriptions]);

  const sortedSubscriptions = useMemo(() => {
    return [...subscriptions].sort((a, b) => new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime());
  }, [subscriptions]);

  const filteredSubscriptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return sortedSubscriptions;
    return sortedSubscriptions.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [search, sortedSubscriptions]);

  const categorySegments = useMemo(() => {
    const totals = new Map<string, number>();
    subscriptions.forEach((item) => {
      const monthly = item.cycle === 'monthly' ? item.price : item.price / 12;
      const cny = toCny(monthly, item.currency);
      totals.set(item.category, (totals.get(item.category) ?? 0) + cny);
    });

    const totalAmount = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(totals.entries()).map(([category, value], index) => ({
      category,
      value,
      percent: totalAmount > 0 ? (value / totalAmount) * 100 : 0,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      gradient: `linear-gradient(90deg, ${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}CC, ${CATEGORY_COLORS[index % CATEGORY_COLORS.length]})`,
    }));
  }, [subscriptions]);

  const deleteSubscription = (id: number) => {
    setSubscriptions((current) => current.filter((item) => item.id !== id));
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowAddForm(true);
  };

  const openEditModal = (subscription: Subscription) => {
    setEditingId(subscription.id);
    setFormData({
      name: subscription.name,
      price: subscription.price,
      currency: subscription.currency,
      cycle: subscription.cycle,
      category: subscription.category,
      nextBillingDate: subscription.nextBillingDate,
      note: subscription.note ?? '',
    });
    setShowAddForm(true);
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { name, category, nextBillingDate, cycle, price, currency, note } = formData;
    if (!name.trim() || !category.trim() || !nextBillingDate || price <= 0) return;
    if (editingId !== null) {
      setSubscriptions((current) =>
        current.map((item) =>
          item.id === editingId
            ? { ...item, name: name.trim(), category: category.trim(), nextBillingDate, cycle, price, currency, note: note?.trim() ?? '' }
            : item
        )
      );
    } else {
      const newSub: Subscription = {
        id: Date.now(),
        name: name.trim(),
        category: category.trim(),
        nextBillingDate,
        cycle,
        price,
        currency,
        note: note?.trim() ?? '',
      };
      setSubscriptions((current) => [newSub, ...current]);
    }
    setFormData(emptyForm);
    setEditingId(null);
    setShowAddForm(false);
  };

  const exportSubscriptions = () => {
    const payload = JSON.stringify(subscriptions, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `subtrack-backup-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main
      className="min-h-screen bg-[#f8f9fa] px-6 py-14 text-[#151515] md:px-10 md:py-16"
      style={{
        backgroundImage:
          'linear-gradient(rgba(125,135,148,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(125,135,148,0.08) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <section className="mx-auto w-full max-w-6xl space-y-10">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs tracking-[0.2em] text-[#7a7a7a]">SUBTRACK 订迹</p>
              <p className="mt-1 font-serif text-xs text-[#7a7a7a]/70">by Lucia</p>
              <h1 className="mt-3 font-serif text-4xl tracking-tight text-[#121212] md:text-5xl">Subscription Control Center</h1>
              <p className="mt-3 text-sm text-[#707070]">Simple overview, clear spending, no surprises.</p>
            </div>
            {isMounted ? (
              <div className="rounded-xl bg-white/75 px-5 py-4 shadow-[0_8px_24px_rgb(0,0,0,0.05)]">
                <p className="font-light text-sm tracking-[0.04em] text-[#5f6874]">{headerDate}</p>
                <p className="mt-1 font-serif text-[12px] tracking-[0.08em] text-[#8a929d]">{headerDateEn}</p>
                <div className="mt-2 h-px w-full bg-[#d9dde3]" />
              </div>
            ) : (
              <div className="h-[84px] w-[220px] rounded-xl bg-white/70 shadow-[0_8px_24px_rgb(0,0,0,0.05)]" />
            )}
          </div>
          <div className="w-full max-w-sm">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search subscriptions"
              className="h-11 w-full rounded-lg border border-[#e5e8ec] bg-white/95 px-3 text-sm outline-none transition-all duration-300 focus:border-[#bac3cc]"
            />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <article className="rounded-xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgb(0,0,0,0.08)]">
            <p className="text-xs tracking-[0.12em] text-[#737373]">Monthly Total (月度总开支)</p>
            <p className="mt-3 text-3xl font-bold"><span className="mr-1 text-xl font-semibold">¥</span>{metrics.monthlyTotal.toFixed(2)}</p>
          </article>
          <article className="rounded-xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgb(0,0,0,0.08)]">
            <p className="text-xs tracking-[0.12em] text-[#737373]">Annual Forecast (年度预估开支)</p>
            <p className="mt-3 text-3xl font-bold"><span className="mr-1 text-xl font-semibold">¥</span>{metrics.annualForecast.toFixed(2)}</p>
          </article>
          <article className="rounded-xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgb(0,0,0,0.08)]">
            <p className="text-xs tracking-[0.12em] text-[#737373]">Active Subs (活跃订阅数)</p>
            <p className="mt-3 text-3xl font-bold">{metrics.activeSubs}</p>
          </article>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="h-3 w-full overflow-hidden rounded-md bg-[#eef2f6]">
            {categorySegments.map((segment) => (
              <span
                key={segment.category}
                className="inline-block h-full"
                style={{ width: `${segment.percent}%`, backgroundImage: segment.gradient }}
                title={`${segment.category} ${segment.percent.toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#677482]">
            {categorySegments.map((segment) => (
              <span key={segment.category} className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                {segment.category} {segment.percent.toFixed(0)}%
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!isMounted || todayTimestamp === null ? (
            <div className="col-span-full rounded-xl bg-white p-10 text-center text-sm text-[#7a7a7a] shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              Loading subscriptions...
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="col-span-full rounded-xl bg-white p-10 text-center text-sm text-[#7a7a7a] shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              No subscriptions found. Try another keyword.
            </div>
          ) : (
            filteredSubscriptions.map((item) => {
              const daysLeft = getDaysUntilBilling(item.nextBillingDate, todayTimestamp);
              const isUrgent = daysLeft <= 3;
              const isOverdue = daysLeft < 0;
              const progress = getBillingProgress(item.nextBillingDate, item.cycle, todayTimestamp);
              const billingDateColor = isOverdue ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-[#424242]';
              const urgencyBarColor = isOverdue ? 'bg-red-500' : isUrgent ? 'bg-amber-500' : daysLeft <= 7 ? 'bg-orange-300' : 'bg-[#d4d8de]';

              return (
                <article
                  key={item.id}
                  className="relative overflow-hidden rounded-xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgb(0,0,0,0.08)]"
                >
                  <span className={`absolute bottom-0 left-0 top-0 w-1 ${urgencyBarColor}`} />
                  {isUrgent ? (
                    <span
                      className={`animate-pulse absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      即将扣费
                    </span>
                  ) : null}

                  <p className="text-xs tracking-[0.12em] text-[#6e6e6e]">{item.category}</p>
                  <h3 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                    <ServiceIcon name={item.name} />
                    {item.name}
                  </h3>
                  <p className="mt-3 text-2xl font-bold">
                    <span className="mr-1 text-base font-semibold">{item.currency === 'USD' ? '$' : '¥'}</span>
                    {item.price.toFixed(2)}
                    <span className="ml-1 text-sm font-medium text-[#7a7a7a]">/ {item.cycle}</span>
                  </p>

                  <div className="mt-4 space-y-1 text-sm">
                    <p className="text-[#7a7a7a]">
                      Next Billing: <span className={`font-semibold ${billingDateColor}`}>{item.nextBillingDate}</span>
                    </p>
                  </div>

                  <div className="mt-4">
                    <div className="h-[6px] w-full rounded-full bg-[#e8edf2]">
                      <div
                        className={`h-[6px] rounded-full transition-all duration-1000 ${isOverdue ? 'bg-red-500' : isUrgent ? 'bg-amber-500' : 'bg-[#6d7784]'}`}
                        style={{ width: progressReady ? `${progress}%` : '0%' }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between">
                    <span />
                    <p className={`text-xs ${billingDateColor}`}>
                      {isOverdue ? `${Math.abs(daysLeft)} day(s) overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft} day(s) remaining`}
                    </p>
                  </div>

                  <div className="mt-5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-[#4a4a4a] transition-all duration-300 hover:bg-[#f8f8f8]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSubscription(item.id)}
                      className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-[#4a4a4a] transition-all duration-300 hover:bg-[#f8f8f8]"
                    >
                      Delete
                    </button>
                  </div>

                  {item.note && item.note.trim() ? (
                    <p
                      className="mt-3 text-[11px] italic text-[#8d96a1]"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minHeight: '2.2em',
                      }}
                    >
                      <span className="mr-1">📝</span>
                      {item.note}
                    </p>
                  ) : (
                    <div className="mt-3 min-h-[2.2em]" />
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      {showAddForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/40 bg-white/80 p-6 shadow-xl backdrop-blur-xl transition-all duration-300">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId !== null ? 'Edit Subscription' : 'Add Subscription'}</h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingId(null);
                  setFormData(emptyForm);
                }}
                className="text-sm text-[#777777] transition-all duration-300 hover:text-[#202020]"
              >
                Close
              </button>
            </div>

            <form className="space-y-3" onSubmit={handleSubmit}>
              <input
                required
                value={formData.name}
                onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                placeholder="Name"
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              />
              <input
                required
                type="number"
                min={0.01}
                step="0.01"
                value={formData.price || ''}
                onChange={(event) => setFormData((current) => ({ ...current, price: Number(event.target.value) || 0 }))}
                placeholder="Price"
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              />
              <select
                value={formData.currency}
                onChange={(event) => setFormData((current) => ({ ...current, currency: event.target.value as Currency }))}
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              >
                <option value="CNY">¥ CNY</option>
                <option value="USD">$ USD</option>
              </select>
              <select
                value={formData.cycle}
                onChange={(event) => setFormData((current) => ({ ...current, cycle: event.target.value as BillingCycle }))}
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              >
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
              </select>
              <input
                required
                value={formData.category}
                onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value }))}
                placeholder="Category"
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              />
              <input
                required
                type="date"
                value={formData.nextBillingDate}
                onChange={(event) => setFormData((current) => ({ ...current, nextBillingDate: event.target.value }))}
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              />
              <input
                value={formData.note ?? ''}
                onChange={(event) => setFormData((current) => ({ ...current, note: event.target.value }))}
                placeholder="Memo / Reason (Optional)"
                title="例如：为了整理相册，7天后需取消"
                className="h-10 w-full rounded-md border border-[#e8e8e8] px-3 text-sm outline-none transition-all duration-300 focus:border-[#d4d4d4]"
              />
              <p className="-mt-1 text-[11px] text-[#8a949f]">例如：为了整理相册，7天后需取消</p>

              <button
                type="submit"
                className="mt-2 h-10 w-full rounded-md border border-[#e5e5e5] bg-[#151515] text-sm font-medium text-white transition-all duration-300 hover:opacity-90"
              >
                {editingId !== null ? 'Save Changes' : 'Create'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openAddModal}
        className="fixed bottom-5 right-16 z-40 inline-flex h-12 items-center justify-center rounded-full bg-gradient-to-br from-[#2f3540] to-[#171a1f] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(23,26,31,0.35)] transition-all duration-300 backdrop-blur hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(23,26,31,0.45)]"
        aria-label="Add new subscription"
      >
        + Add New
      </button>

      <button
        type="button"
        onClick={exportSubscriptions}
        className="fixed bottom-5 left-5 z-40 inline-flex h-10 items-center justify-center rounded-full border border-[#d7dfe7] bg-white px-4 text-xs font-semibold text-[#2c3a48] shadow-sm transition-all duration-300 hover:-translate-y-1"
      >
        导出 JSON
      </button>

      <button
        type="button"
        onClick={requestNotificationPermission}
        className="fixed bottom-5 right-5 z-40 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e6e6e6] bg-white text-sm shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow"
        aria-label="Request notification permission"
        title={`Notifications: ${notificationStatus}`}
      >
        🔔
      </button>
    </main>
  );
}

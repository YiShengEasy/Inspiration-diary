import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { authFetch } from "../lib/authClient";

interface InviteCodeRecord {
  id: string;
  code_hint: string;
  code: string | null;
  created_at: string | number;
  expires_at: string | number;
  used_at: string | number | null;
  revoked_at: string | number | null;
  used_by_email: string | null;
}

interface AdminInvitePageProps {
  onBack: () => void;
}

function inviteStatus(item: InviteCodeRecord): { label: string; tone: string } {
  if (item.revoked_at) return { label: "已撤销", tone: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" };
  if (item.used_at) return { label: "已使用", tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
  if (Number(item.expires_at) <= Date.now()) return { label: "已过期", tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" };
  return { label: "可使用", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
}

function formatTime(value: string | number | null): string {
  return value ? new Date(Number(value)).toLocaleString("zh-CN") : "—";
}

export default function AdminInvitePage({ onBack }: AdminInvitePageProps) {
  const [items, setItems] = useState<InviteCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authFetch("/api/admin/invite-codes");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "邀请码列表加载失败");
      setItems(body.inviteCodes || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "邀请码列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => items.reduce((result, item) => {
    const status = inviteStatus(item).label;
    result.total += 1;
    if (status === "可使用") result.active += 1;
    if (status === "已使用") result.used += 1;
    return result;
  }, { total: 0, active: 0, used: 0 }), [items]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const response = await authFetch("/api/admin/invite-codes", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "邀请码生成失败");
      setNewCodes((body.inviteCodes || []).map((item: InviteCodeRecord) => item.code).filter(Boolean));
      setCopiedCode("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "邀请码生成失败");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
  };

  const copyAll = async () => {
    const codes = items.filter((item) => inviteStatus(item).label === "可使用" && item.code).map((item) => item.code!);
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopiedCode("all");
  };

  const revoke = async (id: string) => {
    setRevokingId(id);
    setError("");
    try {
      const response = await authFetch(`/api/admin/invite-codes/${id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "邀请码撤销失败");
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "邀请码撤销失败");
    } finally {
      setRevokingId("");
    }
  };

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-6xl px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 shadow-sm hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300" aria-label="返回灵感日记">
            <ArrowLeft size={17} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-stone-900 dark:text-stone-100">
              <ShieldCheck size={20} className="text-amber-700 dark:text-amber-300" />
              <h1 className="font-serif text-2xl font-bold">管理员后台</h1>
            </div>
            <p className="mt-1 text-xs text-stone-500">Web 注册邀请码管理</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 刷新
          </button>
          <button type="button" onClick={() => void create()} disabled={creating} className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 一次生成 10 个
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        {[["邀请码总数", stats.total], ["当前可用", stats.active], ["已注册", stats.used]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="text-xs text-stone-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-stone-900 dark:text-stone-100">{value}</div>
          </div>
        ))}
      </div>

      {newCodes.length > 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-50 p-4 dark:bg-emerald-950/40 md:flex-row md:items-center">
          <KeyRound className="shrink-0 text-emerald-700 dark:text-emerald-300" size={20} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">已生成 10 个邀请码，可在下方表格随时查看</div>
            <code className="mt-1 block text-xs font-bold tracking-wider text-emerald-950 dark:text-emerald-100">{newCodes.join("　")}</code>
          </div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(newCodes.join("\n")).then(() => setCopiedCode("new"))} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-600/25 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900">
            {copiedCode === "new" ? <Check size={14} /> : <Copy size={14} />} {copiedCode === "new" ? "已复制" : "复制本批"}
          </button>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">邀请码列表</span>
          <button type="button" onClick={() => void copyAll()} disabled={!items.some((item) => inviteStatus(item).label === "可使用" && item.code)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-950/30">
            {copiedCode === "all" ? <Check size={13} /> : <Copy size={13} />} {copiedCode === "all" ? "已复制全部" : "复制全部可用"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-800 dark:bg-stone-950/60">
              <tr><th className="px-4 py-3 font-semibold">邀请码</th><th className="px-4 py-3 font-semibold">状态</th><th className="px-4 py-3 font-semibold">创建时间</th><th className="px-4 py-3 font-semibold">到期时间</th><th className="px-4 py-3 font-semibold">注册账号</th><th className="px-4 py-3 text-right font-semibold">操作</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-stone-400"><Loader2 className="mx-auto animate-spin" size={18} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-stone-400">暂无邀请码</td></tr>
              ) : items.map((item) => {
                const status = inviteStatus(item);
                const active = status.label === "可使用";
                return (
                  <tr key={item.id} className="text-stone-700 hover:bg-stone-50/70 dark:text-stone-200 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="font-semibold tracking-wider">{item.code || `旧码 ••••-${item.code_hint}`}</code>
                        {item.code && <button type="button" onClick={() => void copy(item.code!)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-amber-700 dark:hover:bg-stone-800" aria-label={`复制邀请码 ${item.code}`}>{copiedCode === item.code ? <Check size={13} /> : <Copy size={13} />}</button>}
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 font-semibold ${status.tone}`}>{status.label}</span></td>
                    <td className="px-4 py-3 text-stone-500">{formatTime(item.created_at)}</td>
                    <td className="px-4 py-3 text-stone-500">{formatTime(item.expires_at)}</td>
                    <td className="px-4 py-3">{item.used_by_email || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {active ? <button type="button" onClick={() => void revoke(item.id)} disabled={revokingId === item.id} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40">{revokingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} 撤销</button> : <span className="text-stone-300 dark:text-stone-700">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

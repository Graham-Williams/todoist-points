import { safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Shared-password sign-in page. A plain HTML form POSTs to /api/login — no
// client JS required, so it works even before the app's bundle loads. The
// password field value never leaves this POST; nothing is persisted client-side.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const error = sp.error;

  const message =
    error === "rate"
      ? "Too many attempts. Wait a few minutes and try again."
      : error === "config"
        ? "Sign-in is misconfigured on the server."
        : error
          ? "Incorrect password."
          : null;

  return (
    <div className="mx-auto mt-20 max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-emerald-400">Todoist Points</h1>
      <p className="mb-6 text-sm text-slate-400">Enter the password to continue.</p>

      {message && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300"
        >
          {message}
        </div>
      )}

      <form method="POST" action="/api/login" className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-slate-300">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}

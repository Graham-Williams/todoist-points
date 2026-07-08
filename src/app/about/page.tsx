import Link from "next/link";

export const metadata = {
  title: "About · Todoist Points",
};

export default function AboutPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">How to point your tasks</h1>
        <p className="mt-2 text-slate-400">
          A quick guide to deciding what a task is worth.
        </p>
      </div>

      <section className="space-y-4 text-slate-300">
        <p>
          The rule of thumb:{" "}
          <span className="font-semibold text-emerald-400">
            a task is worth about one point per minute it takes to complete.
          </span>{" "}
          A five-minute errand is roughly 5 points; an hour of work is roughly
          60.
        </p>

        <p>
          But raw time is only the starting point. Nudge the value up or down
          based on <span className="font-semibold text-white">effort</span> and{" "}
          <span className="font-semibold text-white">dread</span> — how hard the
          task is, and how much you don&apos;t want to do it. Either one can pull
          the number in either direction:
        </p>

        <ul className="space-y-3">
          <li className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <span className="font-semibold text-emerald-400">Point it lower</span>{" "}
            when it&apos;s something you actually want to do. A passion project
            might take an hour but earn less than 60 — you&apos;d work on it
            deadline or not, so it doesn&apos;t need a big reward to pull you in.
          </li>
          <li className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <span className="font-semibold text-rose-400">Point it higher</span>{" "}
            when it&apos;s tedious or frustrating. Twenty minutes on hold with
            customer service can be worth far more than 20 — the points are there
            to make something you dread worth pushing through.
          </li>
        </ul>

        <p>
          Think of a point as a small bribe to your future self. Time gives you
          the ballpark; effort and dread tell you whether to sweeten the deal or
          trim it. Trust your gut, stay roughly consistent, and adjust as you
          learn what actually gets you moving.
        </p>
      </section>

      <div className="border-t border-slate-800 pt-6">
        <Link
          href="/labels"
          className="text-sm font-medium text-emerald-400 hover:text-emerald-300"
        >
          Set your label point values →
        </Link>
      </div>
    </div>
  );
}

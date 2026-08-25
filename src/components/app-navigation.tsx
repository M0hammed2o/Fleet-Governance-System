import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

export async function AppNavigation() {
  const session = await getSession();
  if (!session) return null;
  const links = [
    ["Dashboard", "/dashboard"], ["Onboarding", "/onboarding"], ["Drivers", "/admin/drivers"], ["Vehicles", "/admin/vehicles"], ["Assignments", "/admin/assignments"], ["Staff", "/admin/users"], ["Sites & gates", "/admin/organisation"], ["Gate", "/gate"],
  ];
  return <nav aria-label="Primary navigation" className="min-w-0 border-b border-slate-800 bg-slate-950 text-white"><div className="mx-auto flex min-w-0 max-w-7xl items-center gap-2 px-3 py-3 sm:gap-4 sm:px-6 lg:px-8"><Link href="/dashboard" prefetch={false} className="inline-flex min-h-6 shrink-0 items-center text-sm font-bold tracking-tight">Genbridge <span className="text-cyan-300">Fleet</span></Link><div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" tabIndex={0} aria-label="Application sections">{links.map(([label, href]) => <Link key={href} href={href} prefetch={false} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300">{label}</Link>)}</div><span className="hidden shrink-0 text-xs text-slate-400 xl:block">{session.roleName}</span><LogoutButton /></div></nav>;
}

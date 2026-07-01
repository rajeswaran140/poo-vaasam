import { ReactNode } from "react";
import { cookies } from "next/headers";
import AdminLayoutClient, {
  SIDEBAR_COLLAPSE_COOKIE,
} from "./AdminLayoutClient";

interface AdminLayoutProps {
  children: ReactNode;
}

// Server component: read the sidebar-collapse preference from its cookie so the
// client renders at the correct width on first paint (no expand→collapse flash
// on reload). All interactive behaviour lives in AdminLayoutClient.
export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  const initialCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSE_COOKIE)?.value === "1";

  return (
    <AdminLayoutClient initialCollapsed={initialCollapsed}>
      {children}
    </AdminLayoutClient>
  );
}

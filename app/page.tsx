import DashboardApp from "@/components/DashboardApp";

// Sin esto, Next.js prerenderea "/" como pagina estatica y Vercel la sirve
// directo desde su CDN (cache HIT) sin pasar por proxy.ts en cada visita —
// el gate de la contraseña nunca llega a evaluarse. El login depende de una
// cookie por request, asi que esta ruta tiene que ser dinamica siempre.
export const dynamic = "force-dynamic";

export default function Home() {
  return <DashboardApp />;
}

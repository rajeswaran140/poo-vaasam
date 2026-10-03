import { StemsStudio } from '@/components/admin/stems/StemsStudio';

export default async function StemsPage({ params }: { params: Promise<{ masterJobId: string }> }) {
  const { masterJobId } = await params;
  return <StemsStudio masterJobId={masterJobId} />;
}

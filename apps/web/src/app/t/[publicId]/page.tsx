import { PublicMenuExperience } from '@/features/public-menu/public-menu-experience';

export default async function PublicTablePage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PublicMenuExperience key={publicId} publicId={publicId} />;
}

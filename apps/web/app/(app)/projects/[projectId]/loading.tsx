import { BrandLoader } from '@/components/ui/brand-loader';

export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <BrandLoader />
    </div>
  );
}

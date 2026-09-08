import type { LucideIcon } from 'lucide-react';

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  cardReference?: string;
}

export default function ComingSoon({ icon: Icon, title, description, cardReference }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
      <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center">
        <Icon className="w-7 h-7 text-blue-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      <p className="text-gray-500 max-w-md">{description}</p>
      {cardReference && (
        <p className="text-xs text-gray-400 uppercase tracking-wide mt-2">{cardReference}</p>
      )}
    </div>
  );
}

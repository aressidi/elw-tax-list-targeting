import { Search } from 'lucide-react';
import ComingSoon from '../components/ComingSoon';

export default function ResearchQueue() {
  return (
    <ComingSoon
      icon={Search}
      title="Research Queue"
      description="AI-assisted contact research and prioritization is coming in a future update. For now, add and manage contacts directly from a county's detail page."
      cardReference="Planned: Card 04 - AI Contact Research"
    />
  );
}

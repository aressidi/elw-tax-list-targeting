import { Inbox } from 'lucide-react';
import ComingSoon from '../components/ComingSoon';

export default function Responses() {
  return (
    <ComingSoon
      icon={Inbox}
      title="Responses"
      description="Automatic Gmail monitoring and response classification is coming in a future update. Current request statuses can be tracked from a county's List Requests section."
      cardReference="Planned: Cards 09-10 - Gmail Monitoring & Response Classification"
    />
  );
}

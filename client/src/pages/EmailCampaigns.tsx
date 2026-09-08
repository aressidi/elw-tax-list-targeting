import { Send } from 'lucide-react';
import ComingSoon from '../components/ComingSoon';

export default function EmailCampaigns() {
  return (
    <ComingSoon
      icon={Send}
      title="Email Campaigns"
      description="Sending and tracking FOIA request emails in bulk is coming in a future update. FOIA templates can already be reviewed in the FOIA Templates view."
      cardReference="Planned: Card 07 - Email Sending"
    />
  );
}

import { Settings as SettingsIcon } from 'lucide-react';
import ComingSoon from '../components/ComingSoon';

export default function Settings() {
  return (
    <ComingSoon
      icon={SettingsIcon}
      title="Settings"
      description="Application settings, integrations, and account preferences will live here as more features come online."
    />
  );
}

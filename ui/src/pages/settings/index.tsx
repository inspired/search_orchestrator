/* Settings: health, limits, retention, the fallback notification and webhook destinations
 * (orchestrator_admin only). */
import React from 'react';
import { renderPage } from '../../components/PageShell';
import SettingsPage from '../../features/settings/SettingsPage';

renderPage(<SettingsPage />, 'Settings');

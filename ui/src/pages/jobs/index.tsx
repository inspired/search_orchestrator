/* Jobs: every job the user may see. The page itself is features/jobs/JobsPage. */
import React from 'react';
import { renderPage } from '../../components/PageShell';
import JobsPage from '../../features/jobs/JobsPage';

renderPage(<JobsPage />, 'Jobs');

/* Job builder: ?job_id=<id> edits that job; no id starts a new one. */
import React from 'react';
import { queryParam, renderPage } from '../../components/PageShell';
import BuilderPage from '../../features/builder/BuilderPage';

renderPage(<BuilderPage jobId={queryParam('job_id')} />, 'Job builder');

/* Job builder: ?job_id=<id> edits that job; no id starts a new one, and ?template=<key> starts it from a template. */
import React from 'react';
import { queryParam, renderPage } from '../../components/PageShell';
import BuilderPage from '../../features/builder/BuilderPage';

renderPage(<BuilderPage jobId={queryParam('job_id')} template={queryParam('template')} />, 'Job builder');

/* Job builder: ?job_id=<id> edits that job; no id starts a new one, ?template=<key> starts it from a template, and ?import=1 from a job pasted into Import jobs. */
import React from 'react';
import { queryParam, renderPage } from '../../components/PageShell';
import BuilderPage from '../../features/builder/BuilderPage';
import { takeImportedJob } from '../../features/builder/sourceLogic';

renderPage(<BuilderPage jobId={queryParam('job_id')} template={queryParam('template')} imported={queryParam('import') ? takeImportedJob() : null} />, 'Job builder');
